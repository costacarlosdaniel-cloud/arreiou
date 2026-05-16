/* ============================================================
   Karta · Retail Intelligence — Google Sheets Module
   ============================================================
   Lê dados SAP em tempo real do Google Sheets:
   - SalesKPIsStore  → vendas, ticket, clientes (GID 1828611820)
   - RuturaLojaseCDs → rutura (%)
   - PAO (3)         → quantidade pão, 1º pão, último pão
   - Downtime        → horas fecho loja / padaria
   - quebras         → quebras por supervisor
   - SalesKPIsStore 2 → supervisor por loja
   - SalesKPIsStore 3 → sales ratio por SKU
   - INVENTRIOLOJASARREIOU 1 → inventário por loja
   ============================================================ */

// ── IDs e constantes ─────────────────────────────────────────────────────────
export const GS_ID             = '1ybnb1bMtRxwgcn6OL5fsZ6lD8XBkpXjY';
export const SALES_GID         = '1828611820';
export const SALES_GIDS        = ['1828611820'];
export const SALES_PUBLISHED_ID= '2PACX-1vQ0kvVXS-BM-E7SHdwY_6_3tOHVjHoNLmrrVOaEkLy5W_n2PwJrc8WnPGSnI8TGbQ';
export const PAO_GID           = '1891917083';
export const PAO_GIDS          = ['1891917083', '2021421161'];
export const INV_GID           = '1127908719';

// Cache em memória para as sheets (evita re-fetch desnecessário)
const _gsCache = {};
const GS_MEM_TTL = 10 * 60 * 1000; // 10 minutos

// Dados globais partilhados com app.js
export let SALES_DATA = { lm: {} };   // lm[centro][YYYY-MM] = {vt,vs,tk,cl,n,ru}
export let PAO_DATA   = {};           // [centro][YYYY-MM]    = {h1,hu,pao}
export let PAO_POTENCIAL = {};        // [centro] = media top200 dias
export let INV_HIST_LIVE = {};        // [centro][YYYY-MM]    = {vc,vd}
export let LOJA_SUPERVISORES = {};    // [centro] = {sup, gv}

/* ============================================================
   PARSERS ROBUSTOS
   ============================================================ */

/** Parse de data em 5 formatos diferentes vindos do Google Sheets */
export function pd(v) {
  if (!v || v === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Formato GViz: "Date(2026,2,17)" — mês 0-indexed!
  const gviz = s.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})\)/i);
  if (gviz) return `${gviz[1]}-${String(+gviz[2]+1).padStart(2,'0')}-${String(+gviz[3]).padStart(2,'0')}`;
  // DD/MM/YYYY ou MM/DD/YYYY ou YYYY/MM/DD
  const parts = s.split(/[\/\-]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
    if (+parts[0] > 12)        return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
    return `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
  }
  // Serial Excel (ex: 45678)
  const n = parseFloat(s);
  if (!isNaN(n) && n > 40000 && n < 60000) {
    const d = new Date((n - 25569) * 86400 * 1000);
    return d.toISOString().split('T')[0];
  }
  return null;
}

/** Parse de hora em 4 formatos (Google Sheets envia em formatos inconsistentes) */
export function dtmStr(v) {
  if (!v || v === '') return '';
  const s = String(v).trim();
  // "9:21:33 PM" / "9:21 PM" — 12h
  const ampm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampm) {
    let hh = +ampm[1], mm = +ampm[2];
    const p = ampm[3].toUpperCase();
    if (p === 'PM' && hh !== 12) hh += 12;
    if (p === 'AM' && hh === 12) hh = 0;
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  }
  // "21:22" / "21:22:33" — 24h
  if (/^\d{1,2}:\d{2}/.test(s)) {
    const p = s.split(':');
    return `${String(+p[0]).padStart(2,'0')}:${String(+p[1]).padStart(2,'0')}`;
  }
  // "1899-12-30 21:22:33" — datetime GViz
  const dtm = s.match(/\d{4}-\d{2}-\d{2}[T ]?(\d{2}):(\d{2})/);
  if (dtm) return `${dtm[1]}:${dtm[2]}`;
  // Fração decimal do dia: 0.890671296 → "21:22"
  const n = parseFloat(s.replace(',', '.'));
  if (!isNaN(n) && n >= 0 && n < 1) {
    const h = n * 24, hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 60);
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  }
  return '';
}

/** Parse de número no formato PT/AO: "2 345", "2.345", "2.345,50", "2345,5" */
export function numAny(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  let s = String(v).trim().replace(/\s+/g, '');
  if (!s) return null;
  const hasComma = s.includes(','), hasDot = s.includes('.');
  if (hasComma && hasDot) s = s.replace(/\./g, '').replace(',', '.');
  else if (hasComma) s = s.replace(',', '.');
  else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return isNaN(n) ? null : n;
}

/** Índice de coluna por nome parcial (case-insensitive) */
export function fi(arr, fn) {
  return arr.findIndex(x => x && String(x).toLowerCase().includes(fn.toLowerCase()));
}

/** Normaliza código de loja: "A30", "030", "A030" → "A030" */
export function normCentro(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = s.match(/^(?:A)?(\d{1,4})$/);
  if (m) return 'A' + String(m[1]).padStart(3, '0');
  return s;
}

/* ============================================================
   FETCH CSV COM PAPAP ARSE + FALLBACK PRÓPRIO
   ============================================================ */
export async function fetchCSV(url) {
  const resp = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${url}`);
  const text = await resp.text();
  if (text.startsWith('<')) throw new Error('Google devolveu HTML (sheet não pública ou URL inválido)');
  if (typeof Papa !== 'undefined') {
    return Papa.parse(text, { skipEmptyLines: true }).data;
  }
  return _csvParse(text);
}

function _csvParse(text) {
  const rows = [];
  let cur = '', inQ = false, fields = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { fields.push(cur); cur = ''; }
    else if ((c === '\n' || c === '\r') && !inQ) {
      fields.push(cur); cur = '';
      if (fields.some(f => f !== '')) rows.push(fields);
      fields = [];
      if (c === '\r' && text[i+1] === '\n') i++;
    } else { cur += c; }
  }
  if (cur || fields.length) { fields.push(cur); rows.push(fields); }
  return rows;
}

/* ============================================================
   URLs CANDIDATAS (fallback por GID → nome → publicado)
   ============================================================ */
function _salesUrls(extra) {
  const ts = Date.now(), seen = {}, out = [];
  const add = u => { if (u && !seen[u]) { seen[u] = 1; out.push(u); } };
  if (!extra) {
    add(`https://docs.google.com/spreadsheets/d/e/${SALES_PUBLISHED_ID}/pub?gid=${SALES_GID}&single=true&output=csv`);
    add(`https://docs.google.com/spreadsheets/d/e/${SALES_PUBLISHED_ID}/pub?output=csv`);
  }
  SALES_GIDS.forEach(g => {
    add(`https://docs.google.com/spreadsheets/d/${GS_ID}/gviz/tq?tqx=out:csv&gid=${g}${extra||''}&t=${ts}`);
  });
  ['SalesKPIsStore', 'Sales KPIs Store'].forEach(n => {
    add(`https://docs.google.com/spreadsheets/d/${GS_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(n)}${extra||''}&t=${ts}`);
  });
  return out;
}

function _paoUrls() {
  const ts = Date.now(), seen = {}, out = [];
  const add = u => { if (u && !seen[u]) { seen[u] = 1; out.push(u); } };
  PAO_GIDS.forEach(g => add(`https://docs.google.com/spreadsheets/d/${GS_ID}/gviz/tq?tqx=out:csv&gid=${g}&t=${ts}`));
  ['PAO (3)', 'PAO', 'PÃO', 'Pao', 'Padaria'].forEach(n => {
    add(`https://docs.google.com/spreadsheets/d/${GS_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(n)}&t=${ts}`);
  });
  return out;
}

function _gsUrl(sheetName) {
  return `https://docs.google.com/spreadsheets/d/${GS_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&t=${Date.now()}`;
}

export async function salesFetchCSV(extra) {
  const urls = _salesUrls(extra || '');
  let lastErr;
  for (const url of urls) {
    try {
      const rows = await fetchCSV(url);
      if (rows && rows.length > 0) return rows;
      lastErr = new Error('Sheet de vendas sem linhas');
    } catch(e) { lastErr = e; }
  }
  throw lastErr || new Error('Não foi possível ler SalesKPIsStore');
}

function _paoLooksOk(rows) {
  if (!rows || rows.length < 2) return false;
  const hn = (rows[0] || []).map(x => String(x||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,''));
  return (hn.includes('CENTRO') || hn.includes('NROCENTRO')) &&
         (hn.includes('QUANTIDADE') || hn.includes('QTD'));
}

async function _paoFetchRows() {
  const urls = _paoUrls();
  let lastErr;
  for (const url of urls) {
    try {
      const rows = await fetchCSV(url);
      if (_paoLooksOk(rows)) return rows;
    } catch(e) { lastErr = e; }
  }
  throw lastErr || new Error('Não foi possível localizar a sheet do pão');
}

/* ============================================================
   VALIDADORES DE HORA DO PÃO
   ============================================================ */
function _h1Valid(t) { if (!t) return false; const h = +t.split(':')[0]; return h >= 6 && h <= 9; }
function _huValid(t) { if (!t) return false; const h = +t.split(':')[0]; return h >= 20 && h <= 23; }

function _minsToHHMM(arr) {
  if (!arr.length) return null;
  const avg = Math.round(arr.reduce((a,b) => a+b, 0) / arr.length);
  return `${String(Math.floor(avg/60)).padStart(2,'0')}:${String(avg%60).padStart(2,'0')}`;
}

/* ============================================================
   upsRow — merge de campos num DB em memória
   ============================================================ */
export function upsRow(DB, code, date, fields) {
  if (!DB[code] || !date) return;
  let r = DB[code].r.find(x => x.d === date);
  if (!r) { r = { d: date, vs: null, ru: null, cl: null, tk: null, vp: null, h1: '', hu: '', hl: null, hp: null }; DB[code].r.push(r); }
  Object.assign(r, fields);
}

/* ============================================================
   SYNC POR LOJA (chamado ao abrir uma loja específica)
   ============================================================ */
export async function gsSyncLoja(DB, centro, onStatus) {
  if (!centro || !GS_ID) return;
  const status = msg => { if (onStatus) onStatus(msg); };
  const base = `https://docs.google.com/spreadsheets/d/${GS_ID}/gviz/tq?tqx=out:csv&t=${Date.now()}`;
  const qUrl = (sheet, sql) => `${base}&sheet=${encodeURIComponent(sheet)}&tq=${encodeURIComponent(sql)}`;

  // Vendas
  try {
    const sql = `select A,H,I,J where B='${centro}' order by A desc limit 400000 label A 'dt',H 'vs',I 'tk',J 'cl'`;
    const dV = await salesFetchCSV(`&tq=${encodeURIComponent(sql)}`).catch(() => salesFetchCSV(''));
    const hV = dV[0] || [];
    const i_d = Math.max(fi(hV,'dt'), 0), i_v = Math.max(fi(hV,'vs'), 1);
    const i_t = Math.max(fi(hV,'tk'), 2), i_cl = Math.max(fi(hV,'cl'), 3);
    for (let i = 1; i < dV.length; i++) {
      const r = dV[i], ds = pd(r[i_d]); if (!ds) continue;
      const centro2 = String(r[1]||'').trim() || centro;
      if (centro2 !== centro && i_d === 0) continue; // filtrado no servidor
      upsRow(DB, centro, ds, {
        vs: numAny(r[i_v]) != null ? Math.round(numAny(r[i_v])) : null,
        tk: numAny(r[i_t]) != null ? Math.round(numAny(r[i_t])) : null,
        cl: numAny(r[i_cl]) != null ? Math.round(numAny(r[i_cl])) : null,
      });
    }
  } catch(e) { console.warn('[GS] vendas loja', centro, e.message); }

  // Rutura
  try {
    const dR = await fetchCSV(qUrl('RuturaLojaseCDs', `select B,C where A='${centro}' limit 400000 label B 'dt',C 'ru'`));
    const hR = dR[0] || [];
    const i_rd = Math.max(fi(hR,'dt'), 0), i_rr = Math.max(fi(hR,'ru'), 1);
    for (let i = 1; i < dR.length; i++) {
      const r = dR[i], ds = pd(r[i_rd]); if (!ds) continue;
      const rv = numAny(r[i_rr]);
      upsRow(DB, centro, ds, { ru: rv != null ? Math.round(rv * 10000) / 100 : null });
    }
  } catch(e) { console.warn('[GS] rutura loja', centro, e.message); }

  // Pão
  try {
    const dP = await _paoFetchRows();
    const hP = dP[0] || [];
    let i_pd = hP.findIndex(x => String(x||'').toUpperCase() === 'DATA');
    let i_pc = hP.findIndex(x => String(x||'').toUpperCase() === 'CENTRO');
    let i_pg = hP.findIndex(x => String(x||'').toUpperCase() === 'PTALAO_P');
    let i_ph = hP.findIndex(x => String(x||'').toUpperCase() === 'UTALAO_P');
    let i_pq = hP.findIndex(x => String(x||'').toUpperCase() === 'QUANTIDADE');
    if (i_pd < 0) i_pd = 1; if (i_pc < 0) i_pc = 2;
    if (i_pg < 0) i_pg = 5; if (i_ph < 0) i_ph = 7; if (i_pq < 0) i_pq = 10;
    for (let i = 1; i < dP.length; i++) {
      const r = dP[i];
      if (String(r[i_pc]||'').trim() !== centro) continue;
      const ds = pd(r[i_pd]); if (!ds) continue;
      const h1 = dtmStr(r[i_pg]), hu = dtmStr(r[i_ph]);
      upsRow(DB, centro, ds, {
        h1: _h1Valid(h1) ? h1 : null,
        hu: _huValid(hu) ? hu : null,
        vp: numAny(r[i_pq]) != null ? Math.round(numAny(r[i_pq])) : null,
      });
    }
  } catch(e) { console.warn('[GS] pão loja', centro, e.message); }

  // Downtime
  try {
    const dD = await fetchCSV(qUrl('Downtime', `select Col11,Col12,Col14 where Col4='${centro}' limit 400000 label Col11 'dt',Col12 'hl',Col14 'hp'`));
    const hD = dD[0] || [];
    const i_dd = Math.max(fi(hD,'dt'), 0), i_dhl = Math.max(fi(hD,'hl'), 1), i_dhp = Math.max(fi(hD,'hp'), 2);
    for (let i = 1; i < dD.length; i++) {
      const r = dD[i], ds = pd(r[i_dd]); if (!ds) continue;
      upsRow(DB, centro, ds, {
        hl: r[i_dhl] != null && r[i_dhl] !== '' ? +String(r[i_dhl]).replace(',','.') : null,
        hp: r[i_dhp] != null && r[i_dhp] !== '' ? +String(r[i_dhp]).replace(',','.') : null,
      });
    }
  } catch(e) { console.warn('[GS] downtime loja', centro, e.message); }

  status('✓ Sincronizado');
}

/* ============================================================
   SYNC COMPLETO (chamado no boot e no botão "Sincronizar")
   ============================================================ */
export async function gsSyncAll(DB, onStatus) {
  const status = msg => { if (onStatus) onStatus(msg); };
  const errors = [];

  // ── 1. SalesKPIsStore — totais mensais + últimos 6 meses diário ──────────
  try {
    // Totais mensais por GROUP BY
    const sqlQ = encodeURIComponent("select B, F, sum(H), avg(I), avg(J), count(A) group by B, F label B 'centro', F 'mes', sum(H) 'vt', avg(I) 'tk', avg(J) 'cl', count(A) 'n'");
    const qData = await salesFetchCSV(`&tq=${sqlQ}`);
    const qh = qData[0] || [];
    let qi_c = fi(qh,'centro'), qi_m = fi(qh,'mes'), qi_vt = fi(qh,'vt'), qi_tk = fi(qh,'tk'), qi_cl = fi(qh,'cl'), qi_n = fi(qh,'n');
    if (qi_c < 0) qi_c = 0; if (qi_m < 0) qi_m = 1; if (qi_vt < 0) qi_vt = 2;
    if (qi_tk < 0) qi_tk = 3; if (qi_cl < 0) qi_cl = 4; if (qi_n < 0) qi_n = 5;
    for (let i = 1; i < qData.length; i++) {
      const qr = qData[i];
      const centro = String(qr[qi_c]||'').trim(); if (!centro) continue;
      let mesRaw = String(qr[qi_m]||'').trim();
      if (/^\d{2}\/\d{4}$/.test(mesRaw)) { const p = mesRaw.split('/'); mesRaw = `${p[1]}-${p[0]}`; }
      if (!mesRaw || mesRaw.length < 7) continue;
      const vt = numAny(qr[qi_vt]) || 0;
      const tk = numAny(qr[qi_tk]), cl = numAny(qr[qi_cl]);
      const n  = numAny(qr[qi_n]) || 1;
      if (!SALES_DATA.lm[centro]) SALES_DATA.lm[centro] = {};
      Object.assign(SALES_DATA.lm[centro][mesRaw] || (SALES_DATA.lm[centro][mesRaw] = {}), {
        vt: Math.round(vt), vs: n > 0 ? Math.round(vt/n) : null,
        tk: tk != null ? Math.round(tk) : null, cl: cl != null ? Math.round(cl) : null, n: Math.round(n)
      });
    }

    // Últimos 6 meses — dados diários
    const now = new Date();
    const monthFilters = [];
    for (let mi = 0; mi < 6; mi++) {
      let mn = now.getMonth() - mi, yn = now.getFullYear();
      while (mn < 0) { mn += 12; yn--; }
      monthFilters.push(`(year(A)=${yn} and month(A)=${mn})`);
    }
    const sqlD = encodeURIComponent(`select A,B,H,I,J where ${monthFilters.join(' or ')} label A 'date',B 'centro',H 'vs',I 'tk',J 'cl' limit 400000`);
    const dData = await salesFetchCSV(`&tq=${sqlD}`);
    const dh = dData[0] || [];
    let di_d = fi(dh,'date'), di_c2 = fi(dh,'centro'), di_v = fi(dh,'vs'), di_t = fi(dh,'tk'), di_cl = fi(dh,'cl');
    if (di_d<0) di_d=0; if (di_c2<0) di_c2=1; if (di_v<0) di_v=2; if (di_t<0) di_t=3; if (di_cl<0) di_cl=4;
    for (let i = 1; i < dData.length; i++) {
      const dr = dData[i], ds = pd(dr[di_d]); if (!ds) continue;
      const c = String(dr[di_c2]||'').trim(); if (!c) continue;
      upsRow(DB, c, ds, {
        vs: numAny(dr[di_v]) != null ? Math.round(numAny(dr[di_v])) : null,
        tk: numAny(dr[di_t]) != null ? Math.round(numAny(dr[di_t])) : null,
        cl: numAny(dr[di_cl]) != null ? Math.round(numAny(dr[di_cl])) : null,
      });
    }
    status('Vendas ✓…');
  } catch(e) {
    errors.push('Vendas: ' + e.message);
    // Fallback: leitura bruta completa
    try { await _salesRawFallback(DB); status('Vendas ✓ fallback…'); }
    catch(e2) { errors.push('Vendas fallback: ' + e2.message); }
  }

  // ── 2. RuturaLojaseCDs ────────────────────────────────────────────────────
  try {
    const data2 = await fetchCSV(_gsUrl('RuturaLojaseCDs'));
    const h2 = data2[1] || data2[0] || [];
    let iC2 = fi(h2,'centro'), iD2 = fi(h2,'data'), iR2 = fi(h2,'sumresp');
    if (iC2<0) iC2=0; if (iD2<0) iD2=1; if (iR2<0) iR2=2;
    const start2 = (data2[1] && data2.length > 2) ? 2 : 1;
    const ruMap = {};
    for (let i = start2; i < data2.length; i++) {
      const r = data2[i], ds = pd(r[iD2]); if (!ds) continue;
      const rv = numAny(r[iR2]);
      const ru = rv != null ? Math.round(rv * 10000) / 100 : null;
      upsRow(DB, r[iC2], ds, { ru });
      if (ru != null && r[iC2]) {
        const rc = String(r[iC2]).trim(), rm = ds.substring(0,7);
        if (!ruMap[rc]) ruMap[rc] = {};
        if (!ruMap[rc][rm]) ruMap[rc][rm] = { sum: 0, n: 0 };
        ruMap[rc][rm].sum += ru; ruMap[rc][rm].n++;
      }
    }
    Object.entries(ruMap).forEach(([rc, months]) => {
      if (!SALES_DATA.lm[rc]) SALES_DATA.lm[rc] = {};
      Object.entries(months).forEach(([rm, v]) => {
        if (!SALES_DATA.lm[rc][rm]) SALES_DATA.lm[rc][rm] = {};
        SALES_DATA.lm[rc][rm].ru = v.n > 0 ? v.sum / v.n : null;
      });
    });
    status('Vendas ✓ Rutura ✓…');
  } catch(e) { errors.push('Rutura: ' + e.message); }

  // ── 3. PAO ────────────────────────────────────────────────────────────────
  try {
    const data3 = await _paoFetchRows();
    const h3 = data3[0] || [];
    let iD3 = h3.findIndex(x => String(x||'').toUpperCase() === 'DATA');
    let iC3 = h3.findIndex(x => String(x||'').toUpperCase() === 'CENTRO');
    let iUG3= h3.findIndex(x => String(x||'').toUpperCase() === 'PTALAO_P');
    let iUP3= h3.findIndex(x => String(x||'').toUpperCase() === 'UTALAO_P');
    let iQ3 = h3.findIndex(x => String(x||'').toUpperCase() === 'QUANTIDADE');
    if (iD3<0) iD3=1; if (iC3<0) iC3=2; if (iUG3<0) iUG3=5; if (iUP3<0) iUP3=7; if (iQ3<0) iQ3=10;

    const dailyVp = {}; // para PAO_POTENCIAL top200
    for (let i = 1; i < data3.length; i++) {
      const r = data3[i], ds = pd(r[iD3]); if (!ds) continue;
      const c = normCentro(r[iC3]); if (!c) continue;
      const h1 = dtmStr(r[iUG3]), hu = dtmStr(r[iUP3]);
      const vp = numAny(r[iQ3]);
      upsRow(DB, c, ds, {
        h1: _h1Valid(h1) ? h1 : null,
        hu: _huValid(hu) ? hu : null,
        vp: vp != null ? Math.round(vp) : null,
      });
      // Acumular PAO_DATA mensal
      const mes = ds.substring(0,7);
      if (!PAO_DATA[c]) PAO_DATA[c] = {};
      if (!PAO_DATA[c][mes]) PAO_DATA[c][mes] = { h1m: [], hum: [], ps: 0, n: 0 };
      const pe = PAO_DATA[c][mes];
      if (vp != null && vp > 0) { pe.ps += vp; pe.n++; if (!dailyVp[c]) dailyVp[c] = []; dailyVp[c].push(vp); }
      if (_h1Valid(h1)) { const p = h1.split(':'); pe.h1m.push(+p[0]*60 + +p[1]); }
      if (_huValid(hu)) { const p = hu.split(':'); pe.hum.push(+p[0]*60 + +p[1]); }
    }

    // Calcular PAO_POTENCIAL = média top 200 dias
    Object.entries(dailyVp).forEach(([c, days]) => {
      const top = days.sort((a,b) => b-a).slice(0, 200);
      if (top.length) PAO_POTENCIAL[c] = Math.round(top.reduce((s,v) => s+v, 0) / top.length);
    });

    // Calcular médias mensais
    Object.entries(PAO_DATA).forEach(([c, months]) => {
      Object.entries(months).forEach(([m, pe]) => {
        PAO_DATA[c][m] = {
          h1: _minsToHHMM(pe.h1m || []),
          hu: _minsToHHMM(pe.hum || []),
          pao: pe.n > 0 ? Math.round((pe.ps / pe.n) * 10) / 10 : null,
        };
      });
    });

    status('Vendas ✓ Rutura ✓ Pão ✓…');
  } catch(e) { errors.push('Pão: ' + e.message); }

  // ── 4. Downtime ───────────────────────────────────────────────────────────
  try {
    const data4 = await fetchCSV(_gsUrl('Downtime'));
    const h4 = data4[0] || [];
    const iC4 = fi(h4,'nro centro'), iD4 = fi(h4,'data da informa');
    const iHL4 = fi(h4,'fecho de loja'), iHP4 = fi(h4,'fecho padaria');
    for (let i = 1; i < data4.length; i++) {
      const r = data4[i], ds = pd(r[iD4]); if (!ds) continue;
      upsRow(DB, r[iC4], ds, {
        hl: r[iHL4] != null && r[iHL4] !== '' ? +r[iHL4] : null,
        hp: r[iHP4] != null && r[iHP4] !== '' ? +r[iHP4] : null,
      });
    }
    status('Vendas ✓ Rutura ✓ Pão ✓ Downtime ✓…');
  } catch(e) { errors.push('Downtime: ' + e.message); }

  // ── 5. Quebras ────────────────────────────────────────────────────────────
  try {
    const dataQ = await fetchCSV(_gsUrl('quebras'));
    const hQ = dataQ[0] || [];
    const iQSup=fi(hQ,'supervisor'), iQLoja=fi(hQ,'loja'), iQQtd=fi(hQ,'qtd (unid)');
    const iQMot=fi(hQ,'motivo'), iQAprovStat=fi(hQ,'aprovad'), iQAlert=fi(hQ,'alerta');
    const iQTicket=fi(hQ,'num. ticket'), iQData=fi(hQ,'dt quebra');
    const iQSM = fi(hQ,'sales manager') >= 0 ? fi(hQ,'sales manager') : fi(hQ,'gestor de vendas') >= 0 ? fi(hQ,'gestor de vendas') : fi(hQ,'nome sm');
    const iQRecusa=fi(hQ,'motivo de recusa'), iQAprov=fi(hQ,'lançado');
    const supMap = {}, pendMap = {};
    for (let i = 1; i < dataQ.length; i++) {
      const rQ = dataQ[i];
      let sup = String(rQ[iQSup]||'').trim();
      if (iQLoja >= 0 && String(rQ[iQLoja]||'').includes('||')) {
        const pts = String(rQ[iQLoja]).split('||');
        if (pts[1]) sup = pts[1].trim();
      }
      if (!sup) continue;
      const smVal = iQSM >= 0 ? String(rQ[iQSM]||'').trim() : '';
      if (!supMap[sup]) supMap[sup] = { s: sup, q: 0, regs: 0, al: 0, ap: 0, aq: 0, pe: 0, re: 0, motivos: {}, motivos_ap: {}, al_ap: 0, sm: '' };
      if (!supMap[sup].sm && smVal) supMap[sup].sm = smVal;
      const qtd = +String(rQ[iQQtd]||'0').replace(',','.') || 1;
      supMap[sup].q += qtd; supMap[sup].regs++;
      const alerta = String(rQ[iQAlert]||'').toLowerCase().includes('alerta');
      if (alerta) supMap[sup].al++;
      let isAprov, isRecusa, isPend;
      if (iQAprovStat >= 0) {
        const st = String(rQ[iQAprovStat]||'').trim().toLowerCase();
        isAprov  = ['sim','yes','1','aprovado','aprovada'].includes(st);
        isPend   = ['pendente','pending',''].includes(st);
        isRecusa = !isAprov && !isPend;
      } else {
        const aprov = String(rQ[iQAprov]||'').toLowerCase();
        const recusa = String(rQ[iQRecusa]||'').trim();
        isAprov  = ['1','sim','yes','aprovado','aprovada'].includes(aprov);
        isRecusa = !isAprov && recusa !== '';
        isPend   = !isAprov && !isRecusa;
      }
      const mot = String(rQ[iQMot]||'Outro').trim().substring(0,6);
      supMap[sup].motivos[mot] = (supMap[sup].motivos[mot] || 0) + 1;
      if (isAprov) {
        supMap[sup].ap++; supMap[sup].aq += qtd;
        if (alerta) supMap[sup].al_ap++;
        supMap[sup].motivos_ap[mot] = (supMap[sup].motivos_ap[mot] || 0) + 1;
      } else if (isRecusa) { supMap[sup].re++; }
      else { supMap[sup].pe++; }
      if (isPend) {
        const tkt = iQTicket >= 0 ? String(rQ[iQTicket]||'').trim() : '';
        const da  = iQData  >= 0 ? String(rQ[iQData]  ||'').trim() : '';
        let lojaRaw = iQLoja >= 0 ? String(rQ[iQLoja]||'').trim() : '';
        if (lojaRaw.includes('||')) lojaRaw = lojaRaw.split('||')[0].trim();
        let centroCode = '', lojaNome = lojaRaw;
        const mLoja = lojaRaw.match(/^([A-Z]\d+)\s*[-–]\s*(.+)$/);
        if (mLoja) { centroCode = mLoja[1]; lojaNome = mLoja[2].trim(); }
        if (!pendMap[sup]) pendMap[sup] = { s: sup, sm: smVal, tks: new Set(), qtd: 0, da: '', lojas: {} };
        if (!pendMap[sup].sm && smVal) pendMap[sup].sm = smVal;
        if (tkt) pendMap[sup].tks.add(tkt);
        pendMap[sup].qtd += qtd;
        if (da && (!pendMap[sup].da || da < pendMap[sup].da)) pendMap[sup].da = da;
        const lojaKey = centroCode || lojaRaw;
        if (lojaKey) {
          if (!pendMap[sup].lojas[lojaKey]) pendMap[sup].lojas[lojaKey] = { CentroCode: centroCode, loja_nome: lojaNome, tickets: new Set(), qtd: 0 };
          if (tkt) pendMap[sup].lojas[lojaKey].tickets.add(tkt);
          pendMap[sup].lojas[lojaKey].qtd += qtd;
        }
      }
    }
    const totalQ = Object.values(supMap).reduce((s,x) => s+x.q, 0);
    const qArr = Object.values(supMap).sort((a,b) => b.q - a.q).map(x => {
      x.ta  = x.ap > 0 ? x.al_ap / x.ap : 0;
      x.txa = x.regs > 0 ? x.ap / x.regs : 0;
      x.pct = totalQ > 0 ? x.q / totalQ : 0;
      Object.keys(x.motivos).forEach(k => x[k] = x.motivos[k]);
      Object.keys(x.motivos_ap).forEach(k => x['ap_' + k] = x.motivos_ap[k]);
      delete x.motivos; delete x.motivos_ap;
      return x;
    });
    const pendArr = Object.values(pendMap).map(p => {
      const lojas = Object.values(p.lojas).map(l => ({ CentroCode: l.CentroCode, loja_nome: l.loja_nome, tickets: l.tickets.size, qtd: Math.round(l.qtd) })).sort((a,b) => b.tickets - a.tickets);
      let daFmt = p.da;
      if (/^\d{4}-\d{2}-\d{2}/.test(p.da)) { const dp = p.da.split('-'); daFmt = `${dp[2]}/${dp[1]}/${dp[0]}`; }
      return { s: p.s, sm: p.sm, tk: p.tks.size || 1, qtd: Math.round(p.qtd), da: daFmt, nl: lojas.length, lojas };
    }).sort((a,b) => b.tk - a.tk);
    status('Vendas ✓ Rutura ✓ Pão ✓ Downtime ✓ Quebras ✓…');
    return { qArr, pendArr, totalQ, totalRegs: qArr.reduce((s,x) => s+x.regs, 0) };
  } catch(e) { errors.push('Quebras: ' + e.message); }

  // ── 6. SalesKPIsStore 2 — supervisor por loja ─────────────────────────────
  try {
    const dataS2 = await fetchCSV(_gsUrl('SalesKPIsStore 2'));
    const hS2 = dataS2[0] || [];
    const iS2c = fi(hS2,'nro centro'), iS2s = fi(hS2,'nome supervisor'), iS2g = fi(hS2,'nome gv');
    if (iS2c >= 0 && iS2s >= 0) {
      for (let i = 1; i < dataS2.length; i++) {
        const rs2 = dataS2[i];
        const centro = String(rs2[iS2c]||'').trim();
        const sup    = String(rs2[iS2s]||'').trim();
        if (!centro || !sup) continue;
        LOJA_SUPERVISORES[centro] = { sup, gv: iS2g >= 0 ? String(rs2[iS2g]||'').trim() : '' };
      }
    }
  } catch(e) { errors.push('Supervisores: ' + e.message); }

  // ── 7. Inventário ─────────────────────────────────────────────────────────
  try {
    const invTs = Date.now();
    let invText = null;
    const invUrl1 = `https://docs.google.com/spreadsheets/d/${GS_ID}/gviz/tq?tqx=out:csv&gid=${INV_GID}&t=${invTs}`;
    const invUrl2 = `https://docs.google.com/spreadsheets/d/${GS_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('INVENTRIOLOJASARREIOU 1')}&t=${invTs}`;
    for (const url of [invUrl1, invUrl2]) {
      try {
        const r = await fetch(url);
        if (r.ok) { const t = await r.text(); if (t && !t.startsWith('<') && t.includes('v_Conhecida')) { invText = t; break; } }
      } catch(e) {}
    }
    if (invText) {
      const invRows = (typeof Papa !== 'undefined') ? Papa.parse(invText, {skipEmptyLines:true}).data : _csvParse(invText);
      const hdr = (invRows[0]||[]).map(h => String(h).trim());
      const col = n => { let i = hdr.indexOf(n); return i >= 0 ? i : hdr.findIndex(h => h.toLowerCase().includes(n.toLowerCase())); };
      const _iC = col('IdCentro'), _iDt = col('Data'), _iVC = col('v_Conhecida'), _iVD = col('v_Desconhecida');
      const invMap = {};
      for (let ii = 1; ii < invRows.length; ii++) {
        const ir = invRows[ii];
        const ic = _iC >= 0 ? String(ir[_iC]||'').trim() : ''; if (!ic) continue;
        const ivc = _iVC >= 0 ? parseFloat(String(ir[_iVC]||'').replace(',','.')) : 0;
        const ivd = _iVD >= 0 ? parseFloat(String(ir[_iVD]||'').replace(',','.')) : 0;
        const idt = _iDt >= 0 ? String(ir[_iDt]||'').trim() : ''; if (!idt) continue;
        let idtParsed = null;
        const dm = idt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (dm) idtParsed = new Date(+dm[3], +dm[1]-1, +dm[2]);
        else { const dm2 = idt.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (dm2) idtParsed = new Date(+dm2[1],+dm2[2]-1,+dm2[3]); }
        if (!idtParsed) continue;
        const imes = `${idtParsed.getFullYear()}-${String(idtParsed.getMonth()+1).padStart(2,'0')}`;
        if (!invMap[ic]) invMap[ic] = {};
        if (!invMap[ic][imes]) invMap[ic][imes] = { vcSum: 0, vdSum: 0, n: 0 };
        invMap[ic][imes].vcSum += isNaN(ivc) ? 0 : ivc;
        invMap[ic][imes].vdSum += isNaN(ivd) ? 0 : ivd;
        invMap[ic][imes].n++;
      }
      INV_HIST_LIVE = {};
      Object.entries(invMap).forEach(([c, months]) => {
        INV_HIST_LIVE[c] = {};
        Object.entries(months).forEach(([m, v]) => {
          INV_HIST_LIVE[c][m] = { vc: v.n > 0 ? v.vcSum / v.n : 0, vd: v.n > 0 ? v.vdSum / v.n : 0 };
        });
      });
    }
  } catch(e) { errors.push('Inventário: ' + e.message); }

  status(errors.length ? `Sync concluído (${errors.length} erros)` : '✓ Tudo sincronizado!');
  if (errors.length) console.warn('[GS] erros sync:', errors);
  return { errors };
}

/* ============================================================
   FALLBACK SALES RAW (sem query GViz)
   ============================================================ */
async function _salesRawFallback(DB) {
  const raw = await salesFetchCSV('');
  if (!raw || raw.length < 2) throw new Error('SalesKPIsStore sem dados');
  const h = raw[0] || [];
  const norm = x => String(x||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\[\]_]/g,' ').replace(/\s+/g,' ').trim();
  const idx = (cands, def) => { const hn = h.map(norm); for (const c of cands) { for (let i=0;i<hn.length;i++) if(hn[i].includes(norm(c))) return i; } return def; };
  const iD = idx(['tempo date','date','data'], 0);
  const iC = idx(['nro centro','nr centro','centro'], 1);
  const iV = idx(['vendas liquidas','venda liquida','vendas media dia loja'], 7);
  const iT = idx(['ticket medio','ticket'], 8);
  const iCl= idx(['n clientes medios','clientes medios','clientes'], 9);
  for (let r = 1; r < raw.length; r++) {
    const row = raw[r], ds = pd(row[iD]);
    const centro = String(row[iC]||'').trim(); if (!ds || !centro) continue;
    upsRow(DB, centro, ds, {
      vs: numAny(row[iV]) != null ? Math.round(numAny(row[iV])) : null,
      tk: numAny(row[iT]) != null ? Math.round(numAny(row[iT])) : null,
      cl: numAny(row[iCl]) != null ? Math.round(numAny(row[iCl])) : null,
    });
  }
}

/* ============================================================
   SALES RATIO (SalesKPIsStore 3 — por SKU)
   ============================================================ */
export async function loadSalesRatio() {
  const url = `https://docs.google.com/spreadsheets/d/${GS_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('SalesKPIsStore 3')}&t=${Date.now()}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const csv = await resp.text();
  const rows = (typeof Papa !== 'undefined') ? Papa.parse(csv, {skipEmptyLines:true}).data : _csvParse(csv);
  if (rows.length < 2) throw new Error('Sheet vazia');
  const hdr = (rows[0] || []).map(h => h.replace(/^"|"$/g,'').toLowerCase().trim());
  const iCod  = hdr.findIndex(h => h.includes('sku') || h.includes('código') || h.includes('codigo'));
  const iDesc = hdr.findIndex(h => h.includes('descri') && (h.includes('sku') || !h.includes('sub')));
  const iSec  = hdr.findIndex(h => h.includes('sec') && !h.includes('sub') && !h.includes('cat'));
  const iCat  = hdr.findIndex(h => h.includes('categor') && !h.includes('sub'));
  const iSub  = hdr.findIndex(h => h.includes('sub') && h.includes('categor'));
  const iVend = hdr.findIndex(h => h.includes('venda') || h.includes('liquid'));
  if (iCod < 0 || iVend < 0) throw new Error('Colunas SKU/Vendas não encontradas');
  const skuMap = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sku  = (r[iCod]  || '').replace(/^"|"$/g,'').trim(); if (!sku) continue;
    const desc = (r[iDesc] || '').replace(/^"|"$/g,'').trim();
    const sec  = iSec  >= 0 ? (r[iSec] || '').replace(/^"|"$/g,'').trim() : '';
    const cat  = iCat  >= 0 ? (r[iCat] || '').replace(/^"|"$/g,'').trim() : '';
    const sub  = iSub  >= 0 ? (r[iSub] || '').replace(/^"|"$/g,'').trim() : '';
    const v    = parseFloat((r[iVend]||'').replace(/^"|"$/g,'').replace(/,/g,'.')) || 0;
    if (!skuMap[sku]) skuMap[sku] = { sku, desc, sec, cat, sub, v: 0 };
    skuMap[sku].v += v;
  }
  let totalVendas = 0;
  const skuArr = Object.values(skuMap);
  skuArr.forEach(s => totalVendas += s.v);
  if (totalVendas <= 0) throw new Error('Total de vendas é zero');
  skuArr.forEach(s => s.pct = (s.v / totalVendas) * 100);
  skuArr.sort((a,b) => b.v - a.v);
  let pac = 0;
  skuArr.forEach(s => { pac += s.pct; s.pac = pac; });
  const top200_pct = skuArr.slice(0,200).reduce((a,r) => a + r.pct, 0);
  const catMap = {};
  skuArr.forEach(s => {
    const c = s.cat || s.sec || 'Sem categoria';
    if (!catMap[c]) catMap[c] = { c, v: 0, n: 0 };
    catMap[c].v += s.v; catMap[c].n++;
  });
  const catArr = Object.values(catMap).sort((a,b) => b.v - a.v);
  catArr.forEach(c => c.pct = (c.v / totalVendas) * 100);
  return { skuArr, catArr, totalVendas, top200_pct };
}
