import { state, loadSalesFromGoogleSheet, loadSupervisorsFromGoogleSheet } from './data.js';
import { renderStores, renderKpi, toast, setSync } from './ui.js';
import * as analises from './modules/analises.js';
import * as contagens from './modules/contagens.js';
import * as escalas from './modules/escalas.js';
import * as supervisores from './modules/supervisores.js';
import * as admin from './modules/admin.js';

const modules = {analises, contagens, escalas, supervisores, admin};

function selectStore(code){state.selectedStore=code; renderStores(selectStore); renderCurrent();}
function switchView(view){
  state.currentView=view;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+view)?.classList.add('active');
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  renderCurrent();
}
function renderCurrent(){
  if(state.currentView==='kpi') renderKpi();
  else {const mod=modules[state.currentView]; const el=document.getElementById('view-'+state.currentView); if(mod&&el){el.innerHTML=mod.render(); mod.bind?.();}}
}
async function sync(){
  try{setSync('A ler Google Sheet...'); await loadSalesFromGoogleSheet(); await loadSupervisorsFromGoogleSheet(); renderStores(selectStore); renderCurrent(); setSync('Atualizado'); toast('Dados atualizados da Google Sheet');}
  catch(e){console.error(e); setSync('Erro na Sheet'); toast('Erro ao ler Google Sheet: '+e.message);}
}
function bind(){
  document.getElementById('btnSync').onclick=sync;
  document.getElementById('storeSearch').oninput=()=>renderStores(selectStore);
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
}
async function boot(){
  bind();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
  await sync();
}
boot();
