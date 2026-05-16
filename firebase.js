/* ============================================================
   Karta · Retail Intelligence — Firebase Module
   ============================================================
   - Firestore com cache local TTL
   - Evitar leituras excessivas
   - getDocs apenas quando necessário
   - Sem listeners realtime desnecessários
   ============================================================ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

/* ============================================================
   CONFIGURAÇÃO FIREBASE
   ⚠️ Substitua pelos valores do seu projeto Firebase
   ============================================================ */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "karta-retail.firebaseapp.com",
  projectId: "karta-retail",
  storageBucket: "karta-retail.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:XXXXXXXXXXXXXXXX",
};

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
let app, db, storage, auth;

export function initFirebase() {
  try {
    app = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(app);
    storage = getStorage(app);
    auth = getAuth(app);
    console.log('[Firebase] Inicializado com sucesso');
    return true;
  } catch (error) {
    console.error('[Firebase] Erro na inicialização:', error);
    return false;
  }
}

/* ============================================================
   CACHE LOCAL COM TTL (localStorage)
   ============================================================ */
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos por default

const Cache = {
  set(key, data, ttl = CACHE_TTL) {
    try {
      const entry = { data, expires: Date.now() + ttl };
      localStorage.setItem(`karta_cache_${key}`, JSON.stringify(entry));
    } catch (e) {
      console.warn('[Cache] Erro ao gravar:', e);
    }
  },

  get(key) {
    try {
      const raw = localStorage.getItem(`karta_cache_${key}`);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() > entry.expires) {
        localStorage.removeItem(`karta_cache_${key}`);
        return null;
      }
      return entry.data;
    } catch (e) {
      return null;
    }
  },

  invalidate(key) {
    localStorage.removeItem(`karta_cache_${key}`);
  },

  invalidatePrefix(prefix) {
    Object.keys(localStorage)
      .filter(k => k.startsWith(`karta_cache_${prefix}`))
      .forEach(k => localStorage.removeItem(k));
  },

  clear() {
    Object.keys(localStorage)
      .filter(k => k.startsWith('karta_cache_'))
      .forEach(k => localStorage.removeItem(k));
  },

  size() {
    return Object.keys(localStorage).filter(k => k.startsWith('karta_cache_')).length;
  }
};

export { Cache };

/* ============================================================
   AUTENTICAÇÃO
   ============================================================ */
export const Auth = {
  async signIn(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  },

  async signOut() {
    Cache.clear();
    return signOut(auth);
  },

  onStateChange(callback) {
    return onAuthStateChanged(auth, callback);
  },

  current() {
    return auth?.currentUser || null;
  }
};

/* ============================================================
   STORES (Lojas)
   ============================================================ */
export const StoresDB = {
  async getAll(forceRefresh = false) {
    const cacheKey = 'stores_all';
    if (!forceRefresh) {
      const cached = Cache.get(cacheKey);
      if (cached) return cached;
    }
    const snap = await getDocs(collection(db, 'stores'));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    Cache.set(cacheKey, data, 15 * 60 * 1000); // 15 min
    return data;
  },

  async getOne(storeId) {
    const cacheKey = `store_${storeId}`;
    const cached = Cache.get(cacheKey);
    if (cached) return cached;
    const snap = await getDoc(doc(db, 'stores', storeId));
    if (!snap.exists()) return null;
    const data = { id: snap.id, ...snap.data() };
    Cache.set(cacheKey, data, 15 * 60 * 1000);
    return data;
  },

  async save(storeId, data) {
    const ref = doc(db, 'stores', storeId);
    await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
    Cache.invalidatePrefix('store');
    Cache.invalidate('stores_all');
  },

  async delete(storeId) {
    await deleteDoc(doc(db, 'stores', storeId));
    Cache.invalidatePrefix('store');
    Cache.invalidate('stores_all');
  }
};

/* ============================================================
   DAILY KPIs
   ============================================================ */
export const KPIsDB = {
  async getByStoreAndMonth(storeId, year, month) {
    const cacheKey = `kpis_${storeId}_${year}_${month}`;
    const cached = Cache.get(cacheKey);
    if (cached) return cached;

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const q = query(
      collection(db, 'daily_kpis'),
      where('storeId', '==', storeId),
      where('date', '>=', Timestamp.fromDate(startDate)),
      where('date', '<=', Timestamp.fromDate(endDate)),
      orderBy('date', 'asc')
    );

    const snap = await getDocs(q);
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    Cache.set(cacheKey, data, 10 * 60 * 1000);
    return data;
  },

  async saveDay(storeId, date, kpis) {
    const dateStr = date.toISOString().split('T')[0];
    const docId = `${storeId}_${dateStr}`;
    await setDoc(doc(db, 'daily_kpis', docId), {
      storeId,
      date: Timestamp.fromDate(date),
      dateStr,
      ...kpis,
      updatedAt: serverTimestamp()
    }, { merge: true });
    Cache.invalidatePrefix(`kpis_${storeId}`);
  },

  async getLatestAllStores() {
    const cacheKey = 'kpis_latest_all';
    const cached = Cache.get(cacheKey);
    if (cached) return cached;

    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const q = query(
      collection(db, 'daily_kpis'),
      where('date', '>=', Timestamp.fromDate(startOfMonth)),
      orderBy('date', 'desc'),
      limit(200)
    );

    const snap = await getDocs(q);
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    Cache.set(cacheKey, data, 5 * 60 * 1000);
    return data;
  }
};

/* ============================================================
   MONTHLY TARGETS (Objetivos Mensais)
   ============================================================ */
export const TargetsDB = {
  async get(storeId, year, month) {
    const cacheKey = `target_${storeId}_${year}_${month}`;
    const cached = Cache.get(cacheKey);
    if (cached) return cached;

    const docId = `${storeId}_${year}_${String(month).padStart(2, '0')}`;
    const snap = await getDoc(doc(db, 'monthly_targets', docId));
    const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    Cache.set(cacheKey, data, 30 * 60 * 1000);
    return data;
  },

  async save(storeId, year, month, targets) {
    const docId = `${storeId}_${year}_${String(month).padStart(2, '0')}`;
    await setDoc(doc(db, 'monthly_targets', docId), {
      storeId, year, month, ...targets,
      updatedAt: serverTimestamp()
    }, { merge: true });
    Cache.invalidatePrefix(`target_${storeId}`);
  }
};

/* ============================================================
   INVENTORY COUNTS (Contagens)
   ============================================================ */
export const InventoryDB = {
  async getByStore(storeId, limitN = 50) {
    const cacheKey = `inventory_${storeId}_${limitN}`;
    const cached = Cache.get(cacheKey);
    if (cached) return cached;

    const q = query(
      collection(db, 'inventory_counts'),
      where('storeId', '==', storeId),
      orderBy('createdAt', 'desc'),
      limit(limitN)
    );

    const snap = await getDocs(q);
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    Cache.set(cacheKey, data, 5 * 60 * 1000);
    return data;
  },

  async save(countData) {
    const ref = await addDoc(collection(db, 'inventory_counts'), {
      ...countData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    Cache.invalidatePrefix('inventory_');
    return ref.id;
  },

  async update(docId, data) {
    await updateDoc(doc(db, 'inventory_counts', docId), {
      ...data,
      updatedAt: serverTimestamp()
    });
    Cache.invalidatePrefix('inventory_');
  },

  async delete(docId) {
    await deleteDoc(doc(db, 'inventory_counts', docId));
    Cache.invalidatePrefix('inventory_');
  }
};

/* ============================================================
   SUPERVISOR REVIEWS (Roteiro)
   ============================================================ */
export const ReviewsDB = {
  async getByStore(storeId, year, month) {
    const cacheKey = `reviews_${storeId}_${year}_${month}`;
    const cached = Cache.get(cacheKey);
    if (cached) return cached;

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const q = query(
      collection(db, 'supervisor_reviews'),
      where('storeId', '==', storeId),
      where('visitDate', '>=', Timestamp.fromDate(startDate)),
      where('visitDate', '<=', Timestamp.fromDate(endDate)),
      orderBy('visitDate', 'desc')
    );

    const snap = await getDocs(q);
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    Cache.set(cacheKey, data, 10 * 60 * 1000);
    return data;
  },

  async save(reviewData) {
    const ref = await addDoc(collection(db, 'supervisor_reviews'), {
      ...reviewData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    Cache.invalidatePrefix('reviews_');
    return ref.id;
  },

  async update(docId, data) {
    await updateDoc(doc(db, 'supervisor_reviews', docId), {
      ...data,
      updatedAt: serverTimestamp()
    });
    Cache.invalidatePrefix('reviews_');
  }
};

/* ============================================================
   SCHEDULES (Escalas)
   ============================================================ */
export const SchedulesDB = {
  async get(storeId, year, month) {
    const cacheKey = `schedule_${storeId}_${year}_${month}`;
    const cached = Cache.get(cacheKey);
    if (cached) return cached;

    const docId = `${storeId}_${year}_${String(month).padStart(2, '0')}`;
    const snap = await getDoc(doc(db, 'schedules', docId));
    const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    Cache.set(cacheKey, data, 10 * 60 * 1000);
    return data;
  },

  async save(storeId, year, month, scheduleData) {
    const docId = `${storeId}_${year}_${String(month).padStart(2, '0')}`;
    await setDoc(doc(db, 'schedules', docId), {
      storeId, year, month, ...scheduleData,
      updatedAt: serverTimestamp()
    }, { merge: true });
    Cache.invalidate(`schedule_${storeId}_${year}_${month}`);
  }
};

/* ============================================================
   STORAGE (Upload de Ficheiros)
   ============================================================ */
export const StorageDB = {
  async upload(path, file, onProgress) {
    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file);
    const url = await getDownloadURL(snapshot.ref);
    return url;
  },

  async delete(path) {
    const storageRef = ref(storage, path);
    await deleteObject(storageRef);
  },

  async getUrl(path) {
    const storageRef = ref(storage, path);
    return getDownloadURL(storageRef);
  }
};

/* ============================================================
   APP CONFIG
   ============================================================ */
export const AppConfigDB = {
  async get() {
    const cacheKey = 'app_config';
    const cached = Cache.get(cacheKey);
    if (cached) return cached;

    const snap = await getDoc(doc(db, 'app_config', 'main'));
    const data = snap.exists() ? snap.data() : {};
    Cache.set(cacheKey, data, 60 * 60 * 1000); // 1 hora
    return data;
  },

  async save(config) {
    await setDoc(doc(db, 'app_config', 'main'), {
      ...config,
      updatedAt: serverTimestamp()
    }, { merge: true });
    Cache.invalidate('app_config');
  }
};

/* ============================================================
   DEMO DATA SEEDER (apenas para desenvolvimento)
   ============================================================ */
export async function seedDemoData() {
  console.log('[Seed] A inserir dados demo...');

  const stores = [
    { id: 'A001', name: 'Karta Luanda Centro', city: 'Luanda', supervisor: 'Ana Silva', manager: 'João Costa', active: true, area: 850 },
    { id: 'A002', name: 'Karta Talatona', city: 'Luanda', supervisor: 'Pedro Mendes', manager: 'Maria Fonseca', active: true, area: 1200 },
    { id: 'A003', name: 'Karta Viana', city: 'Viana', supervisor: 'Ana Silva', manager: 'Carlos Lima', active: true, area: 950 },
    { id: 'A004', name: 'Karta Cacuaco', city: 'Luanda', supervisor: 'Pedro Mendes', manager: 'Rita Sousa', active: true, area: 780 },
    { id: 'A005', name: 'Karta Benguela', city: 'Benguela', supervisor: 'Luís Rocha', manager: 'Paula Neto', active: true, area: 1100 },
  ];

  for (const store of stores) {
    await setDoc(doc(db, 'stores', store.id), { ...store, updatedAt: serverTimestamp() });
  }

  // KPIs dos últimos 30 dias para cada loja
  const today = new Date();
  for (const store of stores) {
    for (let d = 29; d >= 0; d--) {
      const date = new Date(today);
      date.setDate(date.getDate() - d);
      const dateStr = date.toISOString().split('T')[0];
      const docId = `${store.id}_${dateStr}`;

      const baseRevenue = 1500000 + Math.random() * 800000;
      const customers = Math.floor(300 + Math.random() * 200);
      const avgTicket = baseRevenue / customers;
      const waste = baseRevenue * (0.01 + Math.random() * 0.02);

      await setDoc(doc(db, 'daily_kpis', docId), {
        storeId: store.id,
        date: Timestamp.fromDate(date),
        dateStr,
        revenue: Math.round(baseRevenue),
        customers,
        avgTicket: Math.round(avgTicket),
        waste: Math.round(waste),
        transactions: customers,
        updatedAt: serverTimestamp()
      });
    }

    // Objetivos mensais
    const targetDocId = `${store.id}_${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}`;
    await setDoc(doc(db, 'monthly_targets', targetDocId), {
      storeId: store.id,
      year: today.getFullYear(),
      month: today.getMonth() + 1,
      revenueTarget: 55000000,
      customersTarget: 9000,
      wasteTarget: 800000,
      updatedAt: serverTimestamp()
    });
  }

  console.log('[Seed] Dados demo inseridos com sucesso!');
}
