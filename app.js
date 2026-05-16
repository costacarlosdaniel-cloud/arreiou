/* ============================================================
   Karta · Retail Intelligence — App Module
   ============================================================ */

import { initFirebase, AppData, AdminCfg, writeEntry, loadEntriesForStoreYear, startEntriesLive, Schedules, SupReviews, InventoryCounts, Cache, backupExport, LOW_COST, COL } from './firebase.js';
import { gsSyncAll, gsSyncLoja, SALES_DATA, PAO_DATA, PAO_POTENCIAL, LOJA_SUPERVISORES, pd, numAny, dtmStr, upsRow, normCentro, fi, loadSalesRatio } from './sheets.js';
import { Fmt, Toast, Loading, Modal, aCard, bRow, bdg, rutBdg, dlBdg, dpBdg, filterTable, exportCSV, debounce, setupInstallPrompt, setupUpdateBanner, setupOfflineBanner } from './ui.js';

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
const APP = {
  view:     'kpi',       // módulo activo
  AS:       null,        // loja seleccionada
  AY:       new Date().getFullYear(),
  ED:       _isoToday(),
  TODAY:    _isoToday(),
  CYR:      new Date().getFullYear(),
  ADMCFG:   { lojas: [] },
  DB:       {},          // DB[centro] = { n, r: [{d, vs, ru, cl, tk, vp, h1, hu, hl, hp}] }
  entries:  {},          // entries['{loja}_{date}'] = {venda_dia, tpas, padeiros, obs, ...}
  FORM_DATA: {},         // SM form data
  SUP_DATA:  {},         // roteiro supervisor
  GERENTE_DATA: {},
  _supTabs: ['top','pao','quebras','downtime','sales','cobertura'],
};
window.APP = APP; // acesso global para callbacks inline

function _isoToday(offset=0) {
  const d = new Date(); d.setDate(d.getDate()+offset);
  return d.toISOString().split('T')[0];
}
function _allDays(yr) {
  const a = [], d = new Date(yr,0,1);
  while (d.getFullYear() === yr) { a.push(d.toISOString().split('T')[0]); d.setDate(d.getDate()+1); }
  return a;
}
const WD = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

/* ── helpers de leitura de entries ───────────────────────────── */
function gE(c, dt)          { return APP.entries[c+'_'+dt] || {}; }
function gS(c, dt)          { return (APP.DB[c]?.r?.find(r => r.d === dt)) || null; }
function sE(c, dt, f, v) {
  const k = c+'_'+dt;
  if (!APP.entries[k]) APP.entries[k] = {};
  if (v===''||v===null||v===undefined) delete APP.entries[k][f]; else APP.entries[k][f] = v;
  try { localStorage.setItem('arrv6', JSON.stringify(APP.entries)); } catch(e) {}
  writeEntry(k, APP.entries[k] || null);
}

/* ============================================================
   INIT
   ============================================================ */
async function init() {
  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[SW]', e));
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'NEW_VERSION') setupUpdateBanner();
    });
  }

  // Firebase
  const fbOk = initFirebase();
  if (!fbOk) Toast.warning('Firebase não ligado — modo offline');

  // PWA
  setupInstallPrompt();
  setupOfflineBanner();

  // entries do localStorage
  try { APP.entries = JSON.parse(localStorage.getItem('arrv6') || '{}'); } catch(e) { APP.entries = {}; }

  // Carregar configuração admin
  await _loadAdmCfg();

  // Navegação
  _setupNav();
  _switchView('kpi');

  // Firebase listeners (low cost)
  startEntriesLive(() => { if (APP.AS) try { renderTable(); } catch(e) {} });

  // Sync Google Sheets em background
  _syncSheets();

  // Dados adicionais async
  _loadAppData();
}

/* ============================================================
   ADMCFG — lojas
   ============================================================ */
async function _loadAdmCfg() {
  let cfg = null;
  try {
    cfg = await AdminCfg.load();
  } catch(e) { console.warn('[App] admcfg error:', e); }

  // Fallback: localStorage
  if (!cfg) {
    try { cfg = JSON.parse(localStorage.getItem('arreiou_adm_obj_v1') || 'null'); } catch(e) {}
  }

  if (cfg?.lojas?.length) {
    APP.ADMCFG = cfg;
    _buildDB(cfg.lojas);
    _buildSidebar(cfg.lojas);
    // Atualizar entries em localStorage com dados frescos do Firebase
    if (APP.AS) await loadEntriesForStoreYear(APP.AS, APP.AY).then(fresh => { Object.assign(APP.entries, fresh); }).catch(() => {});
  }
}

function _buildDB(lojas) {
  lojas.forEach(l => {
    if (!l?.c) return;
    if (!APP.DB[l.c]) APP.DB[l.c] = { n: l.n||l.c, s: l.s||'', r: [] };
    else { APP.DB[l.c].n = l.n||l.c; APP.DB[l.c].s = l.s||''; }
  });
}

function _buildSidebar(lojas) {
  const ul = document.getElementById('sbn'); if (!ul) return;
  const today = APP.TODAY, mes = today.substring(0,7);
  ul.innerHTML = lojas.filter(l => _isLojaActiva(l.c, mes)).map(l => `
    <div class="nav-item" id="nav-${l.c}" onclick="APP._navLoja('${l.c}')">
      <span class="nav-code">${l.c}</span>
      <span class="nav-name">${l.n||l.c}</span>
    </div>`).join('');
}

function _isLojaActiva(c, mes) {
  const l = APP.ADMCFG.lojas.find(x => x.c === c);
  if (!l) return true;
  if (l.inactiva) return false;
  if (l.fecho && l.fecho < mes) return false;
  return true;
}

APP._navLoja = function(c) {
  APP.loadStore(c);
  // fechar sidebar mobile
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sb-overlay')?.classList.remove('active');
};

/* ============================================================
   LOAD STORE
   ============================================================ */
APP.loadStore = async function(c) {
  APP.AS = c; APP.ED = APP.TODAY; APP.AY = APP.CYR;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('on', el.id === 'nav-'+c));
  document.getElementById('btn-hoje')?.style?.setProperty('display','flex');
  _switchView('kpi', { skipRender: true });
  renderPage();
  // Carregar entries do Firebase para esta loja/ano
  try {
    const fresh = await loadEntriesForStoreYear(c, APP.AY);
    Object.assign(APP.entries, fresh);
    renderTable();
  } catch(e) {}
  // Sync SAP
  setTimeout(() => gsSyncLoja(APP.DB, c, msg => _gsStatus(msg)).then(() => { if(APP.AS===c) renderTable(); }).catch(() => {}), 300);
};

/* ============================================================
   NAVEGAÇÃO ENTRE MÓDULOS
   ============================================================ */
function _setupNav() {
  // Top nav tabs
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', () => _switchView(el.dataset.view));
  });
  // Bottom nav mobile
  document.querySelectorAll('[data-bottom]').forEach(el => {
    el.addEventListener('click', () => _switchView(el.dataset.bottom));
  });
  // Sub-tabs analises
  document.querySelectorAll('[data-sub]').forEach(el => {
    el.addEventListener('click', () => _switchSub(el.dataset.sub));
  });
  // Sidebar search
  const sbSearch = document.getElementById('sb-search');
  if (sbSearch) sbSearch.addEventListener('input', debounce(e => _filterSidebar(e.target.value), 200));
  // Sidebar mobile toggle
  const sbToggle = document.getElementById('sb-toggle');
  const sbOv     = document.getElementById('sb-overlay');
  sbToggle?.addEventListener('click', () => { document.getElementById('sidebar')?.classList.toggle('open'); sbOv?.classList.toggle('active'); });
  sbOv?.addEventListener('click', () => { document.getElementById('sidebar')?.classList.remove('open'); sbOv?.classList.remove('active'); });
  // Hoje
  document.getElementById('btn-hoje')?.addEventListener('click', () => { if(!APP.AS){return;} if(APP.AY!==APP.CYR){APP.AY=APP.CYR;} APP.ED=APP.TODAY; loadForm(APP.TODAY); scrollToToday(); });
  // Sync btn
  document.getElementById('btn-sync')?.addEventListener('click', () => _syncSheets());
  // Upload Excel
  document.getElementById('fin')?.addEventListener('change', e => handleUpload(e.target));
}

function _switchView(v, opts={}) {
  APP.view = v;
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('on', el.dataset.view === v));
  document.querySelectorAll('[data-bottom]').forEach(el => el.classList.toggle('on', el.dataset.bottom === v));
  document.querySelectorAll('.shell').forEach(el => el.classList.remove('on'));
  const sh = document.getElementById('sh-'+v);
  if (sh) sh.classList.add('on');
  if (!opts.skipRender) _renderView(v);
}

function _renderView(v) {
  const main = document.getElementById('km');
  if (v === 'kpi')        { if (APP.AS) renderPage(); else _renderStorePrompt(); }
  else if (v === 'analises') { _renderAnalises(); }
  else if (v === 'contagens') { _renderContagens(); }
  else if (v === 'sup')      { _renderRoteiro(); }
  else if (v === 'adm')      { _renderAdmin(); }
}

function _renderStorePrompt() {
  const km = document.getElementById('km');
  if (!km) return;
  km.innerHTML = `<div class="empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--t4)" stroke-width="1.2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg><h3>Selecione uma loja</h3><p>Escolha uma loja na barra lateral para ver os KPIs</p></div>`;
}

function _switchSub(sub) {
  document.querySelectorAll('[data-sub]').forEach(el => el.classList.toggle('on', el.dataset.sub === sub));
  document.querySelectorAll('.asec').forEach(el => el.classList.remove('on'));
  document.getElementById('as-'+sub)?.classList.add('on');
  _renderSubView(sub);
}

/* ============================================================
   KPI PAGE (renderPage + renderTable)
   ============================================================ */
function renderPage() {
  const st = APP.DB[APP.AS]; if (!st) return;
  const yrs = new Set([String(APP.CYR), String(APP.CYR-1)]);
  (st.r||[]).forEach(r => { if(r.d) yrs.add(r.d.slice(0,4)); });
  const yo = [...yrs].sort((a,b)=>b-a).map(y => `<option value="${y}"${+y===APP.AY?' selected':''}>${y}</option>`).join('');
  const km = document.getElementById('km'); if (!km) return;
  km.innerHTML = `
<div class="pghdr">
  <div class="pgtit">
    <h2><span class="ctag">${APP.AS}</span>${st.n}</h2>
    <div class="pgsub" id="gerente-hdr"></div>
  </div>
  <div style="display:flex;align-items:center;gap:10px;margin-left:auto">
    <span id="fb-sync-status" class="upst"></span>
    <select class="yrsel" id="yrsel" onchange="APP._changeYear(this.value)">${yo}</select>
  </div>
</div>
<div class="ecard" id="ecard">
  <div class="clbl">Registo manual</div>
  <div class="edr">
    <span class="edlbl">Data</span>
    <input type="date" id="edt" max="${APP.TODAY}" onchange="APP._onDC(this.value)">
    <span class="ednote" id="enote"></span>
  </div>
  <div class="frow">
    <div class="fld"><label>Venda do dia (AOA)</label><div class="iw"><input type="number" id="iv" placeholder="0" step="1000" oninput="APP._onVendaInput(this)"><span class="iwsuf">AOA</span></div></div>
    <div class="fld"><label>TPAs a funcionar</label><input type="number" id="it" placeholder="0" min="0"></div>
    <div class="fld"><label>Qt. Padeiros</label><input type="number" id="ip" placeholder="0" min="0"></div>
    <div class="fld"><label>Observações</label><input type="text" id="io" placeholder="Nota livre..."></div>
    <div class="fa"><div class="fasp">·</div><button class="bsave" onclick="APP._doSave()">Guardar</button></div>
  </div>
  <div class="smsg" id="smsg">✓ Guardado</div>
</div>
<div class="ktcard">
  <div class="ktbar"><span class="ktbtit" id="kttit">Todos os dias de ${APP.AY}</span></div>
  <div class="ktwrap" id="ktwrap">
    <table class="kt"><thead><tr>
      <th style="text-align:left">Data</th>
      <th class="mc ksep">Venda Dia</th><th class="mc">TPAs</th><th class="mc">Padeiros</th><th class="mc">Obs.</th>
      <th class="ksep">Venda SAP</th><th>Rutura</th><th>Clientes</th>
      <th>Venda Pão</th><th>1º Pão</th><th>Últ. Pão</th><th>Ticket</th>
      <th>DT Loja</th><th>DT Padaria</th><th>Aval.SM</th><th>Rot.Sup</th>
    </tr></thead>
    <tbody id="ktbody"></tbody></table>
  </div>
</div>`;
  loadForm(APP.TODAY);
  renderTable();
  setTimeout(scrollToToday, 120);
  _updateGerenteHdr();
}

function renderTable() {
  const tb = document.getElementById('ktbody'); if (!tb) return;
  let h = '';
  _allDays(APP.AY).slice().reverse().forEach(dt => {
    const sap = gS(APP.AS, dt), ue = gE(APP.AS, dt);
    const iT = dt === APP.TODAY, iF = dt > APP.TODAY;
    const vd = ue.venda_dia ?? null, tp = ue.tpas ?? null, pa = ue.padeiros ?? null, ob = ue.obs || null;
    const rc  = sap?.ru  != null ? (sap.ru > 1.5 ? 'vb' : 'vg') : 've';
    const dlc = sap?.hl  != null ? (sap.hl > 0   ? 'vb' : 'vg') : 've';
    const dpc = sap?.hp  != null ? (sap.hp > 0   ? 'vw' : 'vg') : 've';
    const h1Min = sap?.h1 ? ((p=sap.h1.split(':'))=>+p[0]*60+(+p[1]||0))() : null;
    const huMin = sap?.hu ? ((p=sap.hu.split(':'))=>+p[0]*60+(+p[1]||0))() : null;
    const h1Sty = h1Min != null && h1Min > 485 ? 'color:var(--red);font-weight:600' : '';
    const huSty = huMin != null && huMin < 1260 ? 'color:var(--red);font-weight:600' : '';
    // SM
    const mes = dt.slice(0,7);
    const smDay = ((APP.FORM_DATA[mes]||{})[APP.AS]||{})[dt] || null;
    const smVal = smDay ? parseFloat(smDay.avsm) : NaN;
    const smCol = !isNaN(smVal) ? (smVal>=7?'var(--green)':smVal>=5?'var(--amber)':'var(--red)') : '';
    const smCell = !isNaN(smVal) ? `<td style="text-align:center;font-weight:600;color:${smCol}">${smVal.toFixed(1)}</td>` : '<td class="ve">—</td>';
    // Sup
    const supName = (LOJA_SUPERVISORES[APP.AS]?.sup) || (APP.ADMCFG.lojas.find(l=>l.c===APP.AS)||{}).s || '';
    const supDay  = ((APP.SUP_DATA[mes]||{})[supName]||{})[dt] || null;
    const supVal  = supDay ? parseFloat(supDay.__final__) : NaN;
    const supCol  = !isNaN(supVal) ? (supVal>=7?'var(--green)':supVal>=5?'var(--amber)':'var(--red)') : '';
    const supCell = !isNaN(supVal) ? `<td style="text-align:center;font-weight:600;color:${supCol}">${supVal.toFixed(1)}</td>` : '<td class="ve">—</td>';

    h += `<tr class="${iT?'tod':iF?'fut':''}" id="row-${dt}"${!iF?` onclick="APP._selRow('${dt}')"`:''}>`
      + `<td><div class="dc">${iT?'<span class="tbdg">Hoje</span>':''}<span class="dc-d">${dt}</span><span class="dc-w">${WD[new Date(dt+'T12:00:00').getDay()]}</span></div></td>`
      + `<td class="${vd!=null?'vm':'ve'} ksep">${vd!=null?Fmt.n(vd):'—'}</td>`
      + `<td class="${tp!=null?'vm':'ve'}">${tp!=null?tp:'—'}</td>`
      + `<td class="${pa!=null?'vm':'ve'}">${pa!=null?pa:'—'}</td>`
      + `<td class="${ob?'vm':'ve'}" title="${(ob||'').replace(/"/g,'&quot;')}" style="max-width:120px;overflow:hidden;text-overflow:ellipsis">${ob||'—'}</td>`
      + `<td class="${sap?.vs!=null?'va':'ve'} ksep">${sap?Fmt.n(sap.vs):'—'}</td>`
      + `<td class="${rc}">${sap&&sap.ru!=null?sap.ru.toFixed(2)+'%':'—'}</td>`
      + `<td class="${sap?.cl!=null?'va':'ve'}">${sap?Fmt.n(sap.cl):'—'}</td>`
      + `<td class="${sap?.vp!=null?'va':'ve'}">${sap?Fmt.n(sap.vp):'—'}</td>`
      + `<td class="${sap?.h1?'va':'ve'}" style="${h1Sty}">${sap?.h1||'—'}</td>`
      + `<td class="${sap?.hu?'va':'ve'}" style="${huSty}">${sap?.hu||'—'}</td>`
      + `<td class="${sap?.tk!=null?'va':'ve'}">${sap?Fmt.n(sap.tk):'—'}</td>`
      + `<td class="${dlc}">${sap?.hl!=null?(+sap.hl).toFixed(1)+'h':'—'}</td>`
      + `<td class="${dpc}">${sap?.hp!=null?(+sap.hp).toFixed(1)+'h':'—'}</td>`
      + smCell + supCell
      + '</tr>';
  });
  tb.innerHTML = h;
}

/* ── form helpers ──────────────────────────────────────────────── */
function loadForm(dt) {
  APP.ED = dt;
  const e = gE(APP.AS, dt);
  const di = document.getElementById('edt'); if (di) di.value = dt;
  const no = document.getElementById('enote'); if (no) no.textContent = dt===APP.TODAY?'Hoje':'Data anterior';
  [['iv','venda_dia'],['it','tpas'],['ip','padeiros'],['io','obs']].forEach(([id,k]) => {
    const el = document.getElementById(id); if (el) el.value = e[k] != null ? e[k] : '';
  });
  APP._onVendaInput(document.getElementById('iv'));
}

APP._onDC = v => { if (v > APP.TODAY) { document.getElementById('edt').value=APP.TODAY; return; } loadForm(v); _updateGerenteHdr(v); };
APP._selRow = dt => { loadForm(dt); _updateGerenteHdr(dt); document.getElementById('ecard')?.scrollIntoView({behavior:'smooth',block:'nearest'}); };
APP._onVendaInput = el => {
  const has = el?.value !== '';
  ['lbl-req-t','lbl-req-p'].forEach(id => { const x=document.getElementById(id); if(x) x.style.display=has?'inline':'none'; });
};
APP._changeYear = yr => {
  APP.AY = +yr;
  const tt = document.getElementById('kttit'); if(tt) tt.textContent='Todos os dias de '+APP.AY;
  renderTable();
  loadEntriesForStoreYear(APP.AS, APP.AY).then(f=>{Object.assign(APP.entries,f);renderTable();}).catch(()=>{});
  if(APP.AY===APP.CYR) setTimeout(scrollToToday,60);
};
APP._doSave = () => {
  const elV=document.getElementById('iv'), elT=document.getElementById('it'), elP=document.getElementById('ip');
  const hasVenda = elV&&elV.value!=='';
  if (hasVenda) {
    const erros=[];
    if(!elT||elT.value==='') erros.push('TPAs');
    if(!elP||elP.value==='') erros.push('Padeiros');
    if (erros.length) {
      if(elT&&elT.value===''){elT.style.borderColor='var(--red)';elT.style.background='var(--rbg)';}else if(elT){elT.style.borderColor='';elT.style.background='';}
      if(elP&&elP.value===''){elP.style.borderColor='var(--red)';elP.style.background='var(--rbg)';}else if(elP){elP.style.borderColor='';elP.style.background='';}
      const m=document.getElementById('smsg'); if(m){m.textContent='⚠ Obrigatório: '+erros.join(' e ');m.style.color='var(--red)';m.classList.add('on');setTimeout(()=>{m.classList.remove('on');setTimeout(()=>{m.textContent='✓ Guardado';m.style.color='var(--green)';},200);},3000);}
      return;
    }
  }
  if(elT){elT.style.borderColor='';elT.style.background='';}
  if(elP){elP.style.borderColor='';elP.style.background='';}
  [['iv','venda_dia',false],['it','tpas',false],['ip','padeiros',false],['io','obs',true]].forEach(([id,k,isStr])=>{
    const el=document.getElementById(id); if(!el)return;
    sE(APP.AS,APP.ED,k,isStr?(el.value||null):(el.value!==''?+el.value:null));
  });
  const m=document.getElementById('smsg'); if(m){m.textContent='✓ Guardado';m.style.color='var(--green)';m.classList.add('on');setTimeout(()=>m.classList.remove('on'),2000);}
  renderTable();
};

function scrollToToday() {
  const r=document.getElementById('row-'+APP.TODAY); if(!r) return;
  const w=document.getElementById('ktwrap'); if(w) w.scrollTop=r.offsetTop-w.clientHeight/2+r.clientHeight/2;
  r.style.transition='background .1s'; r.style.background='#ffeaa0'; setTimeout(()=>r.style.background='',700);
}

function _updateGerenteHdr(dt) {
  const el = document.getElementById('gerente-hdr'); if (!el) return;
  const g = (APP.GERENTE_DATA||{})[APP.AS];
  el.textContent = g ? g.nome || '' : '';
}

/* ============================================================
   ANALISES — sub-views
   ============================================================ */
function _renderAnalises() { _switchSub('topflop'); }

function _renderSubView(sub) {
  const body = document.getElementById('as-'+sub); if(!body) return;
  if (sub==='topflop')   _renderTopFlop();
  else if (sub==='pao')  _renderPao();
  else if(sub==='sales') _renderSalesRatio();
}

function _renderTopFlop() {
  const el = document.getElementById('tf-content'); if (!el) return;
  const dt = document.getElementById('tf-date')?.value || APP.TODAY;
  const campos = [
    { key:'vs', label:'Venda SAP', fmt: v=>Fmt.kz(v), asc:false },
    { key:'ru', label:'Rutura %',  fmt: v=>v!=null?v.toFixed(2)+'%':'—', asc:true },
    { key:'cl', label:'Clientes',  fmt: v=>Fmt.n(v), asc:false },
    { key:'vp', label:'Venda Pão', fmt: v=>Fmt.n(v), asc:false },
  ];
  el.innerHTML = campos.map(({ key, label, fmt, asc }) => {
    const rows = Object.entries(APP.DB)
      .map(([c, st]) => ({ c, n: st.n, v: gS(c,dt)?.[key] }))
      .filter(x => x.v != null && !isNaN(x.v))
      .sort((a,b) => asc ? a.v-b.v : b.v-a.v);
    const top5 = rows.slice(0,5), flop5 = [...rows].reverse().slice(0,5);
    const mkList = (arr, good) => arr.map((x,i) => `<div class="brow"><div class="blbl w">${x.c} ${x.n}</div><div class="bval" style="color:${good?'var(--green)':'var(--red)'}">${fmt(x.v)}</div></div>`).join('');
    return `<div class="panel"><div class="phdr">${label}</div><div class="blist">${mkList(top5,!asc)}</div><div class="phdr" style="border-top:1px solid var(--bd)">Flop 5</div><div class="blist">${mkList(flop5,asc)}</div></div>`;
  }).join('');
}

function _renderPao() {
  const el = document.getElementById('as-pao'); if (!el) return;
  const curMes = APP.TODAY.substring(0,7);
  const lojas = APP.ADMCFG.lojas.filter(l=>_isLojaActiva(l.c,curMes)).map(l => {
    const pd = PAO_DATA[l.c] || {};
    const meses = Object.keys(pd).sort();
    const last = meses.length ? pd[meses[meses.length-1]] : null;
    return { c:l.c, n:l.n||l.c, pao:last?.pao, h1:last?.h1, hu:last?.hu, pot:PAO_POTENCIAL[l.c]||null };
  }).sort((a,b)=>(b.pao||0)-(a.pao||0));
  const max = Math.max(1,...lojas.map(l=>l.pao||0));
  el.innerHTML = `<div class="sechdr"><h2>Pão</h2><p>Venda média diária e horários · último mês</p></div>
  <div class="panel"><div class="phdr">Ranking por venda média de pão</div><div class="blist">
  ${lojas.map(l=>`<div class="brow"><div class="blbl w" title="${l.n}">${l.c} ${l.n}</div><div class="btrack"><div class="bfill" style="width:${l.pao?Math.max(1,l.pao/max*100).toFixed(1):0}%;background:#d4a800"></div></div><div class="bval">${l.pao?Fmt.n(Math.round(l.pao)):' —'}</div></div>`).join('')}
  </div></div>`;
}

async function _renderSalesRatio() {
  const el = document.getElementById('as-sales'); if (!el) return;
  Loading.show(el, 'A ler Sales Ratio…');
  try {
    const { skuArr, catArr, totalVendas, top200_pct } = await loadSalesRatio();
    el.innerHTML = `<div class="sechdr"><h2>Sales Ratio</h2><p>Top 200 SKUs = ${top200_pct.toFixed(1)}% das vendas · Total: ${Fmt.kz(totalVendas)}</p></div>
    <div class="panels">
      <div class="panel"><div class="phdr">Por Categoria</div><div class="blist">
      ${catArr.slice(0,15).map(c=>bRow(c.c,c.v,catArr[0].v,'#0070F3',Fmt.kz(c.v)+' ('+c.pct.toFixed(1)+'%)')).join('')}
      </div></div>
      <div class="panel"><div class="phdr">Top 20 SKUs</div><div class="atw"><table class="at"><thead><tr><th class="lft">Descrição</th><th>Vendas</th><th>%</th><th>% Acum.</th></tr></thead><tbody>
      ${skuArr.slice(0,20).map(s=>`<tr><td class="lft" style="font-size:11px">${s.desc||s.sku}</td><td>${Fmt.kz(s.v)}</td><td>${s.pct.toFixed(2)}%</td><td>${s.pac.toFixed(1)}%</td></tr>`).join('')}
      </tbody></table></div></div>
    </div>`;
  } catch(e) {
    Loading.showError(el, 'Erro ao carregar Sales Ratio: ' + e.message);
  }
}

/* ============================================================
   CONTAGENS
   ============================================================ */
async function _renderContagens() {
  const el = document.getElementById('sh-contagens'); if (!el) return;
  const main = el.querySelector('.km') || el;
  Loading.show(main, 'A carregar contagens…');
  try {
    const data = await InventoryCounts.loadAll();
    let rows = [];
    Object.entries(data).forEach(([dt, lojas]) => {
      Object.entries(lojas).forEach(([loja, turnos]) => {
        Object.entries(turnos).forEach(([turno, entry]) => {
          if (!entry) return;
          rows.push({ dt, loja, turno, ...entry });
        });
      });
    });
    rows.sort((a,b)=>b.dt.localeCompare(a.dt));
    main.innerHTML = `<div class="pghdr"><div class="pgtit"><h2>Contagens Diárias</h2></div>
    <button class="bsave" onclick="APP._openNovaContagem()">+ Nova Contagem</button></div>
    <div class="ttb"><input type="text" id="cont-search" placeholder="Pesquisar…" oninput="filterTable(document.getElementById('cont-table'),this.value)">
    <button class="btn-up" onclick="exportCSV(APP._contRows,'contagens')">Exportar CSV</button></div>
    <div class="atw tall"><table class="at" id="cont-table"><thead><tr><th class="lft">Data</th><th class="lft">Loja</th><th class="lft">Turno</th><th class="lft">Responsável</th><th class="lft">Secção</th><th>Contado</th><th>Sistema</th><th>Diferença</th></tr></thead><tbody>
    ${rows.map(r=>{const diff=(r.contado||0)-(r.sistema||0);const dc=diff<0?'vb':diff>0?'vg':'ve';return`<tr><td>${r.dt}</td><td>${r.loja}</td><td>${r.turno}</td><td>${r.responsavel||'—'}</td><td>${r.seccao||'—'}</td><td>${Fmt.n(r.contado)}</td><td>${Fmt.n(r.sistema)}</td><td class="${dc}">${diff>=0?'+':''}${diff}</td></tr>`;}).join('')}
    </tbody></table></div>`;
    APP._contRows = rows;
  } catch(e) { Loading.showError(main, 'Erro: ' + e.message); }
}

APP._openNovaContagem = () => Modal.open('modal-contagem');
APP._saveContagem = async () => {
  const vals = { dt: document.getElementById('nc-dt')?.value, loja: document.getElementById('nc-loja')?.value, turno: document.getElementById('nc-turno')?.value, responsavel: document.getElementById('nc-resp')?.value, seccao: document.getElementById('nc-sec')?.value, contado: +document.getElementById('nc-cont')?.value||0, sistema: +document.getElementById('nc-sis')?.value||0, notas: document.getElementById('nc-notas')?.value };
  if (!vals.loja || !vals.turno || !vals.responsavel) { Toast.error('Preencha loja, turno e responsável'); return; }
  try {
    Loading.showOverlay('A guardar…');
    await InventoryCounts.save(vals.dt, vals.loja, vals.turno, vals);
    Modal.close('modal-contagem');
    Toast.success('Contagem guardada!');
    _renderContagens();
  } catch(e) { Toast.error('Erro: ' + e.message); }
  finally { Loading.hideOverlay(); }
};

/* ============================================================
   ROTEIRO SUPERVISORES
   ============================================================ */
async function _renderRoteiro() {
  const el = document.getElementById('sh-sup'); if (!el) return;
  const main = el.querySelector('.km') || el;
  Loading.show(main, 'A carregar roteiro…');
  try {
    const data = await SupReviews.loadAll();
    Object.assign(APP.SUP_DATA, data);
    const rows = [];
    Object.entries(data).forEach(([mes, sups]) => {
      Object.entries(sups).forEach(([sup, entries]) => {
        Object.entries(entries).forEach(([key, val]) => {
          rows.push({ mes, sup, key, loja: val.__centro__||val.centro||'', nota: val.__final__||val.final, dt: key.match(/(\d{4}-\d{2}-\d{2})/)?.[1]||key });
        });
      });
    });
    rows.sort((a,b) => b.dt.localeCompare(a.dt));
    main.innerHTML = `<div class="pghdr"><div class="pgtit"><h2>Roteiro de Supervisores</h2></div></div>
    <div class="atw tall"><table class="at"><thead><tr><th class="lft">Data</th><th class="lft">Supervisor</th><th class="lft">Loja</th><th>Nota Final</th></tr></thead><tbody>
    ${rows.map(r=>{const nota=parseFloat(r.nota);const nc=!isNaN(nota)?(nota>=7?'vg':nota>=5?'vw':'vb'):'ve';return`<tr><td>${r.dt}</td><td>${r.sup}</td><td>${r.loja||'—'}</td><td class="${nc} mc">${!isNaN(nota)?nota.toFixed(1):'—'}</td></tr>`;}).join('')}
    </tbody></table></div>`;
  } catch(e) { Loading.showError(main, 'Erro: ' + e.message); }
}

/* ============================================================
   ADMIN
   ============================================================ */
function _renderAdmin() {
  const el = document.getElementById('sh-adm'); if (!el) return;
  const main = el.querySelector('.km') || el;
  const lojas = APP.ADMCFG.lojas || [];
  main.innerHTML = `<div class="pghdr"><div class="pgtit"><h2>Administração</h2></div></div>
  <div class="panels">
    <div class="panel"><div class="phdr">Lojas (${lojas.length})<span class="ps">configuradas</span></div>
    <div class="blist">${lojas.map(l=>`<div class="brow"><div class="blbl w"><b style="font-family:var(--mono);font-size:10px;color:var(--t3)">${l.c}</b> ${l.n||l.c}</div><div class="bval" style="font-size:10px;color:var(--t3)">${l.s||'—'}</div></div>`).join('')}</div></div>
    <div class="panel"><div class="phdr">Sistema</div>
    <div class="blist" style="padding:12px 16px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:13px;font-weight:500">Cache local</div><div style="font-size:11px;color:var(--t3)">${Cache.size()} entradas</div></div><button class="btn-up" onclick="APP._clearCache()">Limpar</button></div>
      <div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:13px;font-weight:500">Backup</div><div style="font-size:11px;color:var(--t3)">Exportar configuração JSON</div></div><button class="btn-up" onclick="APP._backup()">Exportar</button></div>
      <div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:13px;font-weight:500">Sync Google Sheets</div><div style="font-size:11px;color:var(--t3)">Forçar sincronização manual</div></div><button class="bsave" onclick="APP._syncNow()">Sincronizar</button></div>
      <div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:13px;font-weight:500">Modo realtime</div><div style="font-size:11px;color:var(--t3)">Firebase listeners em tempo real</div></div><button class="btn-up" onclick="APP._toggleRealtime()">${localStorage.getItem('karta_realtime')==='1'?'Desativar':'Ativar'}</button></div>
    </div></div>
  </div>`;
}

APP._clearCache = () => Modal.confirm('Limpar cache', 'Tem a certeza?', () => { Cache.clear(); Toast.success('Cache limpa!'); _renderAdmin(); });
APP._backup    = () => backupExport(msg => Toast.info(msg));
APP._syncNow   = () => _syncSheets(true);
APP._toggleRealtime = () => { const r=localStorage.getItem('karta_realtime')==='1'; localStorage.setItem('karta_realtime',r?'0':'1'); Toast.info('Reload para aplicar'); setTimeout(()=>location.reload(),1200); };

/* ============================================================
   GOOGLE SHEETS SYNC
   ============================================================ */
async function _syncSheets(force=false) {
  _gsStatus('A sincronizar…');
  try {
    await gsSyncAll(APP.DB, msg => _gsStatus(msg));
    // Re-render se loja activa
    if (APP.AS && APP.view==='kpi') renderTable();
  } catch(e) {
    _gsStatus('Erro sync');
    if (force) Toast.error('Erro sync: ' + e.message);
  }
}

function _gsStatus(msg) {
  const el = document.getElementById('upst'); if (!el) return;
  el.textContent = msg;
  el.className = msg.startsWith('✓') ? 'upst ok' : msg.startsWith('⚠')||msg.startsWith('Erro') ? 'upst err' : 'upst';
}

/* ============================================================
   APPDATA ASYNC
   ============================================================ */
async function _loadAppData() {
  // FORM_DATA (SM)
  try { const v=await AppData.get('sm_form'); if(v){APP.FORM_DATA=v;if(APP.AS)renderTable();} } catch(e){}
  // SUP_DATA
  try { const v=await AppData.get('sup_data'); if(v){Object.assign(APP.SUP_DATA,v);} } catch(e){}
  // Gerentes
  try { const v=await AppData.get('gerentes'); if(v){Object.assign(APP.GERENTE_DATA,v);_updateGerenteHdr();} } catch(e){}
}

/* ============================================================
   UPLOAD EXCEL
   ============================================================ */
function handleUpload(input) {
  const file = input.files[0]; if (!file) return;
  const st = document.getElementById('upst'); if(st){st.textContent='A processar...';st.className='upst';}
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const wb = XLSX.read(ev.target.result, { type:'array', cellDates:true });
      const _pd = v => { if(!v)return null; if(v instanceof Date)return v.toISOString().split('T')[0]; return String(v).split('T')[0]; };
      const _dtm = v => { if(!v||isNaN(v))return''; const h=v*24,hh=Math.floor(h)%24,mm=Math.floor((h-Math.floor(h))*60); return String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0'); };
      const ups = (code,date,fields) => { if(!APP.DB[code]||!date)return; let r=APP.DB[code].r.find(x=>x.d===date); if(!r){r={d:date,vs:null,ru:null,cl:null,tk:null,vp:null,h1:'',hu:'',hl:null,hp:null};APP.DB[code].r.push(r);} Object.assign(r,fields); };
      // SalesKPIsStore
      const w1 = wb.Sheets['SalesKPIsStore'];
      if (w1) { const raw=XLSX.utils.sheet_to_json(w1,{header:1,defval:null}),h=raw[1]||[]; const iD=h.findIndex(x=>x&&String(x).includes('Date')),iC=h.findIndex(x=>x&&String(x).includes('Nro Centro')),iV=h.findIndex(x=>x&&String(x).includes('Vendas_Liquidas')),iT=h.findIndex(x=>x&&String(x).includes('Ticket')),iCl=h.findIndex(x=>x&&String(x).includes('Clientes')); for(let i=2;i<raw.length;i++){const r=raw[i],ds=_pd(r[iD]);if(!ds)continue;ups(String(r[iC]||'').trim(),ds,{vs:r[iV]?Math.round(+r[iV]):null,tk:r[iT]?Math.round(+r[iT]):null,cl:r[iCl]?Math.round(+r[iCl]):null});} }
      // RuturaLojaseCDs
      const w2 = wb.Sheets['RuturaLojaseCDs'];
      if (w2) { const raw=XLSX.utils.sheet_to_json(w2,{header:1,defval:null}),h=raw[1]||[]; const iC=h.findIndex(x=>x&&String(x).includes('centro')),iD=h.findIndex(x=>x&&String(x).includes('Data')),iR=h.findIndex(x=>x&&String(x).includes('SumResp')); for(let i=2;i<raw.length;i++){const r=raw[i],ds=_pd(r[iD]);if(!ds)continue;ups(r[iC],ds,{ru:r[iR]!=null?Math.round(+r[iR]*10000)/100:null});} }
      // PAO (3)
      const w3 = wb.Sheets['PAO (3)'];
      if (w3) { const raw=XLSX.utils.sheet_to_json(w3,{header:1,defval:null}),h=raw[0]||[]; const iC=h.indexOf('CENTRO'),iD=h.indexOf('DATA'),iQ=h.indexOf('QUANTIDADE'),iUG=h.indexOf('PTALAO_P'),iUP=h.indexOf('UTALAO_P'); for(let i=1;i<raw.length;i++){const r=raw[i],ds=_pd(r[iD]);if(!ds)continue;ups(r[iC],ds,{vp:r[iQ]?Math.round(+r[iQ]):null,h1:_dtm(r[iUG]),hu:_dtm(r[iUP])});} }
      // Downtime
      const w4 = wb.Sheets['Downtime'];
      if (w4) { const raw=XLSX.utils.sheet_to_json(w4,{header:1,defval:null}),h=raw[0]||[]; const iC=h.findIndex(x=>x&&String(x).includes('Nro Centro')),iD=h.findIndex(x=>x&&String(x).includes('Data da informa')),iHL=h.findIndex(x=>x&&String(x).includes('fecho de Loja')),iHP=h.findIndex(x=>x&&String(x).includes('Fecho Padaria')); for(let i=1;i<raw.length;i++){const r=raw[i],ds=_pd(r[iD]);if(!ds)continue;ups(r[iC],ds,{hl:r[iHL]!=null?+r[iHL]:null,hp:r[iHP]!=null?+r[iHP]:null});} }
      if(st){st.textContent='✓ Actualizado';st.className='upst ok';setTimeout(()=>{st.textContent='';st.className='upst';},4000);}
      if(APP.AS) renderTable();
    } catch(err) { if(st){st.textContent='Erro: '+err.message;st.className='upst err';} console.error(err); }
  };
  reader.readAsArrayBuffer(file); input.value='';
}

function _filterSidebar(q) {
  q = (q||'').toLowerCase();
  const mes = APP.TODAY.substring(0,7);
  document.querySelectorAll('#sbn .nav-item').forEach(el => {
    const code=(el.querySelector('.nav-code')||{}).textContent||'';
    const name=(el.querySelector('.nav-name')||{}).textContent||'';
    if (!_isLojaActiva(code,mes)){el.style.display='none';return;}
    el.style.display = !q||code.toLowerCase().includes(q)||name.toLowerCase().includes(q) ? '' : 'none';
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
// Expor funções necessárias globalmente
window.renderTable     = renderTable;
window.filterTable     = filterTable;
window.exportCSV       = exportCSV;
window.loadForm        = loadForm;
window.handleUpload    = handleUpload;
window.scrollToToday   = scrollToToday;
