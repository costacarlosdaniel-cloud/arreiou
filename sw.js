// ── Karta · Service Worker v2.1 ─────────────────────────────────────────────
const CACHE = 'karta-v3-sync-fix';

const PRECACHE = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300;14..32,400;14..32,500;14..32,600&family=JetBrains+Mono:wght@400;500&display=swap',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all([
        c.add('/index.html').catch(() => {}),
        c.addAll(PRECACHE).catch(() => {})
      ])
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { method, url } = e.request;
  if (method !== 'GET') return;
  if (url.includes('firebaseio.com')) return;
  if (url.includes('firestore.googleapis.com')) return;
  if (url.includes('gstatic.com/firebasejs')) return;
  if (url.includes('googleapis.com/identitytoolkit')) return;
  if (url.includes('googleapis.com/spreadsheets')) return;
  if (url.includes('docs.google.com')) return;

  // index.html — network first, cache fallback
  if (e.request.mode === 'navigate' || url.endsWith('/') || url.endsWith('/index.html')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(r => {
          const toCache = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, toCache));
          return r;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // CDN / fonts — cache first
  if (url.includes('cdnjs.cloudflare.com') || url.includes('fonts.g')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(r => {
          if (r && r.status === 200) {
            const toCache = r.clone();
            caches.open(CACHE).then(c => c.put(e.request, toCache));
          }
          return r;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Default — network only
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).catch(() => caches.match(e.request))
  );
});
