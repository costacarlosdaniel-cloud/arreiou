import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app-check.js';
import { getFirestore, collection, doc, getDoc, setDoc, getDocs, query, where, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js';

// NOVO FIREBASE: substitui estes dados pelos do teu novo projeto.
export const firebaseConfig = {
  apiKey: 'COLOCA_AQUI',
  authDomain: 'COLOCA_AQUI.firebaseapp.com',
  projectId: 'COLOCA_AQUI',
  storageBucket: 'COLOCA_AQUI.appspot.com',
  messagingSenderId: 'COLOCA_AQUI',
  appId: 'COLOCA_AQUI'
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);

export function enableAppCheck(siteKey){
  if(!siteKey || siteKey.includes('COLOCA')) return;
  initializeAppCheck(app,{provider:new ReCaptchaV3Provider(siteKey),isTokenAutoRefreshEnabled:true});
}

export async function getSetting(key, fallback=null){
  const snap = await getDoc(doc(db,'app_config',key));
  return snap.exists() ? snap.data().value : fallback;
}
export async function setSetting(key,value){
  return setDoc(doc(db,'app_config',key),{value,updatedAt:serverTimestamp()},{merge:true});
}
export async function saveDailyKpi(row){
  const id = `${row.storeCode}_${row.date}`;
  return setDoc(doc(db,'daily_kpis',id),{...row,updatedAt:serverTimestamp()},{merge:true});
}
export async function getDailyKpis(start,end){
  const q = query(collection(db,'daily_kpis'), where('date','>=',start), where('date','<=',end), orderBy('date'));
  const snap = await getDocs(q);
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}
export async function saveInventoryCount(row){
  const id = `${row.date}_${row.storeCode}_${Date.now()}`;
  return setDoc(doc(db,'inventory_counts',id),{...row,createdAt:serverTimestamp()});
}
