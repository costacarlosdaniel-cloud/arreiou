export const CONFIG = {
  appVersion: 'karta-nova-2026-05-16-001',
  googleSheetId: '1ybnb1bMtRxwgcn6OL5fsZ6ID8XBkpXjY',
  sheets: {
    sales: 'SalesKPIsStore',
    supervisors: 'SalesKPIsStore 2',
    salesRatio: 'SalesKPIsStore 3',
    inventory: 'INVENTRIOLOJASARREIOU 1'
  },
  cacheTtlMs: 12 * 60 * 60 * 1000
};

export const state = {
  stores: [],
  sales: [],
  selectedStore: null,
  currentView: 'kpi'
};

const cacheKey = k => `karta_nova_${k}`;
export function readCache(key){
  try{const raw=localStorage.getItem(cacheKey(key)); if(!raw) return null; const v=JSON.parse(raw); if(Date.now()-v.ts>CONFIG.cacheTtlMs) return null; return v.data;}catch{return null;}
}
export function writeCache(key,data){try{localStorage.setItem(cacheKey(key),JSON.stringify({ts:Date.now(),data}));}catch{}}
export function clearCache(){Object.keys(localStorage).filter(k=>k.startsWith('karta_nova_')).forEach(k=>localStorage.removeItem(k));}

export function parseCsv(text){
  const rows=[]; let row=[], cell='', q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(c==='"' && q && n==='"'){cell+='"'; i++; continue;}
    if(c==='"'){q=!q; continue;}
    if(c===',' && !q){row.push(cell); cell=''; continue;}
    if((c==='\n'||c==='\r') && !q){if(cell||row.length){row.push(cell); rows.push(row); row=[]; cell='';} if(c==='\r'&&n==='\n') i++; continue;}
    cell+=c;
  }
  if(cell||row.length){row.push(cell); rows.push(row);}
  return rows;
}
const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
const findCol = (h,names) => names.map(norm).map(n=>h.findIndex(x=>norm(x).includes(n))).find(i=>i>=0) ?? -1;
const num = v => {const s=String(v??'').replace(/\s/g,'').replace(/\./g,'').replace(',','.'); const n=parseFloat(s); return Number.isFinite(n)?n:null;};
const dateVal = v => {const s=String(v||'').trim(); const g=s.match(/^Date\((\d+),(\d+),(\d+)\)/); if(g) return `${g[1]}-${String(+g[2]+1).padStart(2,'0')}-${String(+g[3]).padStart(2,'0')}`; const m=s.match(/\d{4}-\d{2}-\d{2}/); return m?m[0]:s.slice(0,10);};

export async function fetchSheet(sheetName, querySql=''){
  const key = `sheet_${sheetName}_${querySql}`;
  const cached = readCache(key); if(cached) return cached;
  const tq = querySql ? '&tq=' + encodeURIComponent(querySql) : '';
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.googleSheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}${tq}&t=${Date.now()}`;
  const res = await fetch(url,{cache:'no-store'});
  if(!res.ok) throw new Error(`Google Sheet HTTP ${res.status}`);
  const rows = parseCsv(await res.text());
  writeCache(key, rows);
  return rows;
}

export async function loadSalesFromGoogleSheet(){
  const rows = await fetchSheet(CONFIG.sheets.sales);
  const h = rows[0] || [];
  const iDate=findCol(h,['date','data','dt']);
  const iStore=findCol(h,['centro','loja','store']);
  const iSales=findCol(h,['vs','venda','sales']);
  const iTicket=findCol(h,['tk','ticket']);
  const iClients=findCol(h,['cl','clientes']);
  const out=[];
  for(const r of rows.slice(1)){
    const storeCode=String(r[iStore]||'').trim(); if(!storeCode) continue;
    out.push({date:dateVal(r[iDate]),storeCode,sales:num(r[iSales])||0,ticket:num(r[iTicket])||0,clients:num(r[iClients])||0});
  }
  state.sales = out;
  buildStores();
  return out;
}

export async function loadSupervisorsFromGoogleSheet(){
  try{
    const rows = await fetchSheet(CONFIG.sheets.supervisors);
    const h=rows[0]||[]; const iStore=findCol(h,['centro','loja','store']); const iName=findCol(h,['nome','loja']); const iSup=findCol(h,['supervisor','sales manager','gestor']);
    rows.slice(1).forEach(r=>{const c=String(r[iStore]||'').trim(); const st=state.stores.find(s=>s.code===c); if(st){st.name=String(r[iName]||st.name||c).trim(); st.supervisor=String(r[iSup]||'').trim();}});
  }catch(e){console.warn(e);}
}

function buildStores(){
  const map = new Map();
  state.sales.forEach(r=>{if(!map.has(r.storeCode)) map.set(r.storeCode,{code:r.storeCode,name:r.storeCode,supervisor:''});});
  state.stores = [...map.values()].sort((a,b)=>a.code.localeCompare(b.code));
  if(!state.selectedStore && state.stores[0]) state.selectedStore = state.stores[0].code;
}

export function metricsForStore(code){
  const rows = state.sales.filter(r=>r.storeCode===code).sort((a,b)=>a.date.localeCompare(b.date));
  const last = rows.at(-1);
  const month = last ? last.date.slice(0,7) : '';
  const mrows = rows.filter(r=>r.date.startsWith(month));
  const sales = mrows.reduce((a,r)=>a+r.sales,0);
  const clients = mrows.reduce((a,r)=>a+r.clients,0);
  return {rows,mrows,last,month,sales,clients,ticket:clients?sales/clients:0,days:mrows.length};
}

export function ranking(){
  return state.stores.map(s=>{const m=metricsForStore(s.code); return {...s,...m};}).sort((a,b)=>b.sales-a.sales);
}
