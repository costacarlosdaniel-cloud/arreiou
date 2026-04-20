// ── Arreiou KPI — Service Worker ─────────────────────────────────────────────
// Estratégia: Network-first para index.html, cache para assets estáticos
// Quando há nova versão, o SW notifica a página para recarregar

const CACHE_NAME = 'arreiou-kpi-v1';

// Assets que podem ser cached (CDN libs)
const CACHEABLE = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300;14..32,400;14..32,500;14..32,600&display=swap',
];

// ── Install: pre-cache static assets ─────────────────────────────────────────
self.addEventListener('install', function(e) {
  self.skipWaiting(); // activate immediately
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CACHEABLE).catch(function() {}); // silent fail
    })
  );
});

// ── Activate: clean old caches ────────────────────────────────────────────────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim(); // take control immediately
    })
  );
});

// ── Fetch: network-first for HTML, cache-first for static assets ──────────────
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Always bypass for Google APIs, Firebase, and dynamic requests
  if (url.includes('firebaseio.com') ||
      url.includes('googleapis.com/spreadsheets') ||
      url.includes('gstatic.com/firebasejs') ||
      url.includes('anthropic.com') ||
      e.request.method !== 'GET') {
    return; // let browser handle normally
  }

  // index.html — always network-first, no cache
  if (url.endsWith('/') || url.endsWith('/index.html') ||
      url.includes('arreiou-sigma.vercel.app') && !url.includes('.')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .catch(function() {
          // Offline fallback: serve from cache if available
          return caches.match(e.request);
        })
    );
    return;
  }

  // Static CDN assets — cache-first
  if (CACHEABLE.some(function(u) { return url.startsWith(u.split('?')[0]); })) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        return cached || fetch(e.request).then(function(response) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
          return response;
        });
      })
    );
    return;
  }

  // Everything else — network with no-store to prevent stale caches
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).catch(function() {
      return caches.match(e.request);
    })
  );
});
