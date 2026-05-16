/* ============================================================
   Karta · Retail Intelligence — Firebase Module
   Firebase SDK 12.11.0 | App Check reCAPTCHA v3
   Low Cost Mode: cache TTL + debounce + sem listeners desnecessários
   ============================================================ */

import { initializeApp }                                           from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import { initializeAppCheck, ReCaptchaV3Provider }                from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app-check.js';
import { getStorage, ref as storageRef, uploadString, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, query, orderBy, where, limit, startAt, endAt,
  writeBatch, onSnapshot, serverTimestamp, documentId, Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';

/* ============================================================
   CONFIGURAÇÃO
   ============================================================ */
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyCnX0O3b3K6NyRI7OGoo4558CcDwaDlVGA',
  authDomain:        'kpi-turbo.firebaseapp.com',
  projectId:         'kpi-turbo',
  storageBucket:     'kpi-turbo.firebasestorage.app',
  messagingSenderId: '464632148548',
  appId:             '1:464632148548:web:bf2b377444b61d3c704211',
};

const APPCHECK_SITE_KEY = '6Le6kcwsAAAAAHFejyKY51nAnAZFRKqMVHeeqYUa';

/* ============================================================
   LOW COST MODE
   ============================================================ */
export const LOW_COST      = true;
const APPDATA_TTL          = 24 * 60 * 60 * 1000;   // 24h
const QUERY_TTL            = 12 * 60 * 60 * 1000;   // 12h
const MAPCOL_TTL           =  2 * 60 * 60 * 1000;   // 2h
const WRITE_DEBOUNCE       = 3000;                   // 3s
export const REALTIME_MODE = localStorage.getItem('karta_realtime') === '1';

/* ============================================================
   COLLECTIONS
   ============================================================ */
export const COL = {
  ENTRIES:   'entries',
  APPDATA:   'appData',
  SUP_REV:   'supervisor_reviews',
  FIXED:     'fixed_assets',
  CASH:      'cash_closures',
  INV:       'inventory_counts',
  SCHEDULES: 'store_schedules',
  DOCS:      'store_documents',
  ADMCFG:    'app_config',
};

/* ============================================================
   INIT
   ============================================================ */
let _app, _db, _storage;

export function initFirebase() {
  try {
    _app     = initializeApp(FIREBASE_CONFIG);
    _db      = getFirestore(_app);
    _storage = getStorage(_app);

    // App Check
    try {
      if (APPCHECK_SITE_KEY && APPCHECK_SITE_KEY.length > 20) {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = false;
        initializeAppCheck(_app, {
          provider: new ReCaptchaV3Provider(APPCHECK_SITE_KEY),
          isTokenAutoRefreshEnabled: true,
        });
      }
    } catch(e) { console.warn('[AppCheck]', e); }

    // Cache bust por deploy
    _cacheBustOnDeploy();

    // Captura de erros de rede silenciosa
    window.addEventListener('unhandledrejection', e => {
      const msg = String((e.reason && e.reason.message) || e.reason || '');
      if (msg.includes('offline') || msg.includes('network') || msg.includes('Failed to fetch') || msg.includes('QuotaExceeded')) return;
      console.warn('[Karta] Promise não tratada:', e.reason);
    });

    console.log('[Firebase] OK — low cost mode:', LOW_COST, '| realtime:', REALTIME_MODE);
    return true;
  } catch(e) {
    console.error('[Firebase] init error:', e);
    return false;
  }
}

function _cacheBustOnDeploy() {
  const metaVer = (document.querySelector('meta[name="app-version"]')||{}).content || '1';
  const stored  = localStorage.getItem('karta_cache_ver');
  if (stored === 'v' + metaVer) return;
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith('karta_cache_') || k.startsWith('fs_entries_') || k.startsWith('karta_em_') || k.startsWith('karta_mapcol_') || k.endsWith('_ts')) {
      toRemove.push(k);
    }
  }
  toRemove.forEach(k => localStorage.removeItem(k));
  localStorage.setItem('karta_cache_ver', 'v' + metaVer);
  console.log(`[Karta] Cache limpa (deploy v${metaVer}), ${toRemove.length} entradas`);
}

/* ============================================================
   HELPERS INTERNOS
   ============================================================ */
const _safeId  = id  => String(id  || '').replace(/[\/\.#$\[\]]/g, '_');
const _clone   = v   => { try { return JSON.parse(JSON.stringify(v)); } catch(e) { return v; } };
const _isImage = v   => typeof v === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(v);
const _imgExt  = v   => { const m = String(v||'').match(/^data:image\/([^;]+);base64,/i); return (['jpg','png','webp','gif'].includes((m&&m[1]||'').toLowerCase().replace('jpeg','jpg')) ? (m[1]||'').toLowerCase().replace('jpeg','jpg') : 'jpg'); };

/* ============================================================
   CACHE LOCAL (localStorage + timestamp separado)
   ============================================================ */
export const Cache = {
  get(key) {
    try {
      const ts = +(localStorage.getItem(`karta_cache_${key}_ts`) || 0);
      const raw = localStorage.getItem(`karta_cache_${key}`);
      if (!ts || !raw) return null;
      return { data: JSON.parse(raw), ts };
    } catch(e) { return null; }
  },
  set(key, data) {
    try {
      localStorage.setItem(`karta_cache_${key}`, JSON.stringify(data));
      localStorage.setItem(`karta_cache_${key}_ts`, String(Date.now()));
    } catch(e) {}
  },
  fresh(key, ttl) {
    const c = this.get(key);
    if (!c) return null;
    return (Date.now() - c.ts) < ttl ? c.data : null;
  },
  invalidate(key) {
    localStorage.removeItem(`karta_cache_${key}`);
    localStorage.removeItem(`karta_cache_${key}_ts`);
  },
  invalidatePrefix(prefix) {
    Object.keys(localStorage).filter(k => k.startsWith(`karta_cache_${prefix}`)).forEach(k => localStorage.removeItem(k));
  },
  clear() {
    Object.keys(localStorage).filter(k => k.startsWith('karta_cache_')).forEach(k => localStorage.removeItem(k));
  },
  size() {
    return Object.keys(localStorage).filter(k => k.startsWith('karta_cache_')).length;
  },
};

/* ============================================================
   APPDATA (configurações, adm, sup_cfg, etc.)
   ============================================================ */
async function _appGet(path) {
  const id  = _safeId(path);
  const ck  = `app_${id}`;
  if (LOW_COST) {
    const cached = Cache.fresh(ck, APPDATA_TTL);
    if (cached !== null) return cached;
  }
  const snap = await getDoc(doc(_db, COL.APPDATA, id));
  const val  = snap.exists() ? snap.data().value : null;
  Cache.set(ck, val);
  return val;
}

async function _appSet(path, val) {
  const id = _safeId(path);
  Cache.set(`app_${id}`, val);
  const d = doc(_db, COL.APPDATA, id);
  if (val === null || val === undefined) return deleteDoc(d);
  return setDoc(d, { value: val, updatedAt: serverTimestamp() }, { merge: false });
}

/* ============================================================
   ENTRIES (KPI diário: chave = {lojaId}_{YYYY-MM-DD})
   ============================================================ */

// Batch write com hash para evitar duplicados
const _entryQueue = {}, _entryHash = {};
let _entryTimer = null;

function _hashVal(v) { try { return JSON.stringify(v||null); } catch(e) { return String(v); } }

export async function flushEntries() {
  clearTimeout(_entryTimer); _entryTimer = null;
  const items = Object.entries(_entryQueue);
  Object.keys(_entryQueue).forEach(k => delete _entryQueue[k]);
  if (!items.length) return;
  try {
    let batch = writeBatch(_db), n = 0;
    for (const [k, val] of items) {
      const h = _hashVal(val);
      if (_entryHash[k] === h) continue;
      _entryHash[k] = h;
      const id = _safeId(k);
      if (val === null || (typeof val === 'object' && !Object.keys(val).length)) {
        batch.delete(doc(_db, COL.ENTRIES, id));
      } else {
        const parts = k.split('_');
        batch.set(doc(_db, COL.ENTRIES, id), {
          value: val, key: k,
          loja:  parts.slice(0,-1).join('_'),
          data:  parts.pop(),
          mes:   (parts.pop()||'').substring(0,7),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      if (++n % 450 === 0) { await batch.commit(); batch = writeBatch(_db); }
    }
    if (n % 450 !== 0 || n === 0) await batch.commit();
    _setSyncStatus('✓ sincronizado', 'ok');
  } catch(e) {
    console.warn('[FB] flush entries error:', e);
    _setSyncStatus('⚠ Erro ao gravar', 'err');
  }
}

export function writeEntry(compositeKey, val) {
  // Atualizar localStorage imediatamente
  try {
    const all = JSON.parse(localStorage.getItem('arrv6') || '{}');
    if (val === null) delete all[compositeKey]; else all[compositeKey] = val;
    localStorage.setItem('arrv6', JSON.stringify(all));
  } catch(e) {}
  _invalidateEntryCaches(compositeKey);
  _entryQueue[compositeKey] = val;
  if (!LOW_COST) { flushEntries(); return; }
  clearTimeout(_entryTimer);
  _entryTimer = setTimeout(flushEntries, WRITE_DEBOUNCE);
  _setSyncStatus('a guardar…', '');
}

function _invalidateEntryCaches(k) {
  try {
    const parts = k.split('_'), dt = parts[parts.length-1], loja = parts.slice(0,-1).join('_');
    const yr = dt ? dt.slice(0,4) : '';
    if (loja && yr) {
      Cache.invalidate(`entries_${loja}_${yr}`);
      Cache.invalidate(`query_${loja}_${yr}-01-01__${loja}_${yr}-12-31`);
    }
    if (dt && dt.length >= 7) Cache.invalidate(`em_${dt.substring(0,7)}`);
  } catch(e) {}
}

// Carregar entries de um store/ano inteiro
export async function loadEntriesForStoreYear(loja, year) {
  const ck = `entries_${loja}_${year}`;
  if (LOW_COST) {
    const cached = Cache.fresh(ck, QUERY_TTL);
    if (cached !== null) {
      // Merge em localStorage
      try {
        const all = JSON.parse(localStorage.getItem('arrv6') || '{}');
        Object.assign(all, cached);
        localStorage.setItem('arrv6', JSON.stringify(all));
      } catch(e) {}
      return cached;
    }
  }
  const q = query(
    collection(_db, COL.ENTRIES),
    where('loja', '==', loja),
    where('data', '>=', `${year}-01-01`),
    where('data', '<=', `${year}-12-31`),
    orderBy('data', 'asc')
  );
  const snap = await getDocs(q);
  const out = {};
  snap.forEach(d => { const dd = d.data(); if (dd.key) out[dd.key] = dd.value || {}; });
  Cache.set(ck, out);
  try {
    const all = JSON.parse(localStorage.getItem('arrv6') || '{}');
    Object.assign(all, out);
    localStorage.setItem('arrv6', JSON.stringify(all));
  } catch(e) {}
  return out;
}

// Listener realtime últimos 3 dias (apenas se REALTIME_MODE)
let _liveUnsub = null;
export function startEntriesLive(onUpdate) {
  if (LOW_COST && !REALTIME_MODE) return;
  if (_liveUnsub) { try { _liveUnsub(); } catch(e) {} }
  const d3ago = new Date(); d3ago.setDate(d3ago.getDate() - 2);
  const start = d3ago.toISOString().split('T')[0];
  _liveUnsub = onSnapshot(
    query(collection(_db, COL.ENTRIES), where('data', '>=', start)),
    snap => {
      snap.docChanges().forEach(ch => {
        if (ch.type === 'removed') return;
        const dd = ch.doc.data();
        const k  = dd.key || ch.doc.id;
        try {
          const all = JSON.parse(localStorage.getItem('arrv6') || '{}');
          all[k] = dd.value || {};
          localStorage.setItem('arrv6', JSON.stringify(all));
          Cache.invalidate(`em_${(dd.data||'').substring(0,7)}`);
        } catch(e) {}
      });
      if (onUpdate) onUpdate();
    }
  );
}

window.addEventListener('beforeunload', () => { try { if (Object.keys(_entryQueue).length) flushEntries(); } catch(e) {} });

/* ============================================================
   APPDATA — helpers públicos
   ============================================================ */
export const AppData = {
  get:  path => _appGet(path),
  set:  (path, val) => _appSet(path, val),
};

/* ============================================================
   MAP COLLECTIONS (store_schedules, fixed_assets, etc.)
   ============================================================ */
async function _loadMapCol(colName) {
  const ck = `mapcol_${colName}`;
  if (LOW_COST) {
    const cached = Cache.fresh(ck, MAPCOL_TTL);
    if (cached !== null) return cached;
  }
  const snap = await getDocs(collection(_db, colName));
  const out = {};
  snap.forEach(d => { out[d.id] = d.data(); });
  Cache.set(ck, out);
  return out;
}

async function _writeModuleDoc(colName, id, data, extra = {}) {
  Cache.invalidate(`mapcol_${colName}`);
  const cleanData = _firestoreSafeValue(data);
  return setDoc(doc(_db, colName, _safeId(id)), {
    value: cleanData, ...extra, updatedAt: serverTimestamp()
  }, { merge: true });
}

export const Schedules = {
  loadAll: () => _loadMapCol(COL.SCHEDULES),
  save: (loja, data) => _writeModuleDoc(COL.SCHEDULES, loja, data, { loja }),
};

export const FixedAssets = {
  loadAll: () => _loadMapCol(COL.FIXED),
  save: (loja, data) => _writeModuleDoc(COL.FIXED, loja, data, { loja }),
};

export const CashClosures = {
  loadAll: () => _loadMapCol(COL.CASH),
  save: (loja, data) => _writeModuleDoc(COL.CASH, loja, data, { loja }),
};

export const StoreDocs = {
  loadAll: () => _loadMapCol(COL.DOCS),
  save: (loja, data) => _writeModuleDoc(COL.DOCS, loja, data, { loja }),
};

/* ============================================================
   INVENTORY COUNTS
   ============================================================ */
export const InventoryCounts = {
  async loadAll() {
    const snap = await getDocs(collection(_db, COL.INV));
    const out = {};
    snap.forEach(d => {
      const dd = d.data() || {};
      const { data: dt, loja, turno, value } = dd;
      if (!dt || !loja || !turno) return;
      if (!out[dt]) out[dt] = {};
      if (!out[dt][loja]) out[dt][loja] = {};
      out[dt][loja][turno] = _firestoreSafeDeserialize(value || {});
    });
    return out;
  },
  save(date, loja, turno, entry) {
    const id = _safeId(`${date}__${loja}__${turno}`);
    return _writeModuleDoc(COL.INV, id, entry, { data: date, loja, turno, mes: String(date||'').substring(0,7) });
  },
};

/* ============================================================
   SUPERVISOR REVIEWS
   ============================================================ */
export const SupReviews = {
  async loadAll() {
    const ck = 'sup_reviews';
    if (LOW_COST) {
      const cached = Cache.fresh(ck, MAPCOL_TTL);
      if (cached !== null) return cached;
    }
    const snap = await getDocs(collection(_db, COL.SUP_REV));
    const out = {};
    snap.forEach(d => {
      const dd = d.data() || {};
      const mes = dd.mes, sup = dd.sup, key = dd.key;
      if (!mes || !sup || !key) return;
      if (!out[mes]) out[mes] = {};
      if (!out[mes][sup]) out[mes][sup] = {};
      out[mes][sup][key] = dd.value || {};
    });
    Cache.set(ck, out);
    return out;
  },

  async save(mes, supName, saveKey, val) {
    Cache.invalidate('sup_reviews');
    const docId = _safeId(`${mes}__${supName}__${saveKey}`);
    if (val === null || val === undefined) {
      return deleteDoc(doc(_db, COL.SUP_REV, docId));
    }
    // Upload fotos para Storage
    const cleanVal = await _replaceImagesWithUrls(val, `supervisor_reviews/${_safeId(mes)}/${_safeId(supName)}/${_safeId(saveKey)}`);
    const fsVal    = _firestoreSafeValue(cleanVal);
    return setDoc(doc(_db, COL.SUP_REV, docId), {
      value: fsVal, mes, sup: supName, key: saveKey,
      data:  _supKeyToDate(saveKey),
      loja:  (cleanVal && cleanVal.__centro__) || (fsVal && fsVal.centro) || '',
      final: (cleanVal && cleanVal.__final__ != null) ? cleanVal.__final__ : null,
      isDraft: !!(cleanVal && cleanVal.__draft__),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  },
};

function _supKeyToDate(k) {
  const m = String(k||'').match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

/* ============================================================
   ADMIN CONFIG (ADMCFG) — lojas, supervisores, config geral
   ============================================================ */
export const AdminCfg = {
  async load() {
    const ck = 'admcfg';
    if (LOW_COST) {
      const cached = Cache.fresh(ck, APPDATA_TTL);
      if (cached !== null) return cached;
    }
    const val = await _appGet('adm_obj');
    Cache.set(ck, val);
    return val;
  },
  save: data => _appSet('adm_obj', data),
};

/* ============================================================
   STORAGE — upload de imagens
   ============================================================ */
export async function uploadFile(path, file) {
  const r = storageRef(_storage, path);
  const snap = await uploadBytes(r, file);
  return getDownloadURL(snap.ref);
}

export async function uploadDataUrl(path, dataUrl) {
  const r = storageRef(_storage, path);
  await uploadString(r, dataUrl, 'data_url');
  return getDownloadURL(r);
}

async function _replaceImagesWithUrls(obj, basePath, seen) {
  seen = seen || new WeakSet();
  if (_isImage(obj)) {
    try {
      const ext = _imgExt(obj);
      return await uploadDataUrl(`${basePath}.${ext}`, obj);
    } catch(e) {
      return { __photo_upload_failed__: true, code: e.code||'', message: String(e.message||'').slice(0,180), size: String(obj||'').length };
    }
  }
  if (!obj || typeof obj !== 'object') return obj;
  if (seen.has(obj)) return obj;
  seen.add(obj);
  if (Array.isArray(obj)) {
    const arr = [];
    for (let i = 0; i < obj.length; i++) arr[i] = await _replaceImagesWithUrls(obj[i], `${basePath}/${i}`, seen);
    return arr;
  }
  const out = {};
  for (const k of Object.keys(obj)) out[k] = await _replaceImagesWithUrls(obj[k], `${basePath}/${_safeId(k)}`, seen);
  return out;
}

/* ============================================================
   SANITIZAÇÃO FIRESTORE
   Converte __campo__ → campo (Firestore não aceita __ em nomes)
   Remove imagens base64 grandes
   ============================================================ */
const _KEY_MAP = { '__final__':'final','__draft__':'draft','__centro__':'centro','__ts__':'ts','__comment__':'comment','__rating__':'rating','__photo_local_only__':'photo_local_only','__photo_upload_failed__':'photo_upload_failed' };

function _firestoreSafeValue(obj, seen) {
  seen = seen || new WeakSet();
  if (_isImage(obj)) return { photo_local_only: true, size: String(obj||'').length };
  if (!obj || typeof obj !== 'object') return obj;
  if (seen.has(obj)) return null;
  seen.add(obj);
  if (Array.isArray(obj)) return obj.map(v => _firestoreSafeValue(v, seen));
  const out = {};
  for (const k of Object.keys(obj)) {
    const nk = _KEY_MAP[k] || String(k).replace(/^__+/, '').replace(/__+$/, '') || 'field';
    out[nk] = _firestoreSafeValue(obj[k], seen);
  }
  return out;
}

function _firestoreSafeDeserialize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  return obj; // ler tal qual
}

/* ============================================================
   SYNC STATUS
   ============================================================ */
function _setSyncStatus(msg, cls) {
  const el = document.getElementById('fb-sync-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'upst' + (cls ? ' ' + cls : '');
  if (cls === 'ok') setTimeout(() => { el.textContent = ''; el.className = 'upst'; }, 2500);
}

/* ============================================================
   BACKUP / EXPORT
   ============================================================ */
export async function backupExport(onMsg) {
  const msg = m => { if (onMsg) onMsg(m); };
  const out = {};
  msg('A exportar...');
  try {
    for (const [label, path] of [
      ['adm_obj','adm_obj'], ['escalas','escalas'], ['sup_cfg','sup_cfg'],
      ['gerentes','gerentes'], ['tab_cfg','tab_cfg'],
    ]) {
      out[label] = await _appGet(path).catch(() => null);
    }
    out.entries_sample = Object.fromEntries(
      Object.entries(JSON.parse(localStorage.getItem('arrv6')||'{}')).slice(0, 100)
    );
    out.exportedAt = new Date().toISOString();
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `karta_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click(); URL.revokeObjectURL(url);
    msg('✓ Backup exportado');
  } catch(e) { msg('Erro: ' + e.message); }
}
