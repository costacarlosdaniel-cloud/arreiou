import { state, metricsForStore } from './data.js';

export const $ = s => document.querySelector(s);
export const fmt = n => (Number(n)||0).toLocaleString('pt-AO',{maximumFractionDigits:0});
export const money = n => fmt(n) + ' AOA';
export const pct = n => (Number(n)||0).toLocaleString('pt-AO',{maximumFractionDigits:1}) + '%';

export function toast(msg){const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._to); t._to=setTimeout(()=>t.classList.remove('show'),2600);}
export function setSync(msg,cls=''){const el=$('#syncState'); if(el){el.textContent=msg; el.className='state '+cls;}}

export function renderStores(onSelect){
  const q=($('#storeSearch')?.value||'').toLowerCase();
  const list=$('#storeList');
  list.innerHTML=state.stores.filter(s=>(s.code+' '+s.name).toLowerCase().includes(q)).map(s=>`<div class="store ${s.code===state.selectedStore?'active':''}" data-code="${s.code}"><code>${s.code}</code><span>${s.name||s.code}</span></div>`).join('') || '<div class="empty">Sem lojas</div>';
  list.querySelectorAll('.store').forEach(el=>el.onclick=()=>onSelect(el.dataset.code));
}

export function pageTitle(title, sub=''){
  return `<div class="page-title"><div><h1>${title}</h1>${sub?`<p>${sub}</p>`:''}</div></div>`;
}
export function card(label,value,hint=''){
  return `<div class="card"><div class="label">${label}</div><div class="value">${value}</div>${hint?`<div class="hint">${hint}</div>`:''}</div>`;
}
export function table(headers, rows){
  return `<div class="table-wrap"><table class="table"><thead><tr>${headers.map(h=>`<th class="${h.right?'right':''}">${h.t}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

export function renderKpi(){
  const m=metricsForStore(state.selectedStore);
  const st=state.stores.find(s=>s.code===state.selectedStore) || {code:'—',name:'Escolhe uma loja'};
  $('#view-kpi').innerHTML = pageTitle(`${st.code} · ${st.name}`, `Dados lidos da Google Sheet · mês ${m.month||'—'}`) +
    `<div class="cards">${card('Vendas mês',money(m.sales),`${m.days} dias com dados`)}${card('Clientes',fmt(m.clients))}${card('Ticket médio',money(m.ticket))}${card('Último dia',m.last?m.last.date:'—',m.last?money(m.last.sales):'')}</div>`+
    `<div class="grid2"><div class="panel"><h2>Evolução diária</h2>${table([{t:'Data'},{t:'Vendas',right:1},{t:'Clientes',right:1},{t:'Ticket',right:1}], m.mrows.slice(-31).map(r=>`<tr><td>${r.date}</td><td class="right">${money(r.sales)}</td><td class="right">${fmt(r.clients)}</td><td class="right">${money(r.ticket||((r.clients?r.sales/r.clients:0)))}</td></tr>`))}</div><div class="panel"><h2>Resumo da loja</h2><div class="panel-body"><p><b>Supervisor:</b> ${st.supervisor||'—'}</p><p><b>Origem:</b> Google Sheet / Firestore</p><p><b>Estrutura:</b> pronta para novo Firebase.</p></div></div></div>`;
}
