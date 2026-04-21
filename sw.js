// ── Arreiou KPI — Service Worker ─────────────────────────────────────────────
// Combina: cache de libs CDN (original) + suporte offline completo (novo)

const CACHE_NAME = 'arreiou-kpi-v3';

// Libs CDN a fazer cache — evita re-download e funciona offline
const CACHEABLE_CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300;14..32,400;14..32,500;14..32,600&display=swap',
];

self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.all([
        cache.add('/index.html').catch(function() {}),
        cache.addAll(CACHEABLE_CDN).catch(function() {})
      ]);
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  var method = e.request.method;

  if (method !== 'GET' ||
      url.includes('firebaseio.com') ||
      url.includes('googleapis.com/spreadsheets') ||
      url.includes('docs.google.com') ||
      url.includes('gstatic.com/firebasejs') ||
      url.includes('anthropic.com')) {
    return;
  }

  // index.html: network-first, fallback cache offline
  if (url.endsWith('/') || url.endsWith('/index.html') || e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(function(r) {
          var clone = r.clone();
          caches.open(CACHE_NAME).then(function(c) { c.put(e.request, clone); });
          return r;
        })
        .catch(function() { return caches.match('/index.html'); })
    );
    return;
  }

  // Libs CDN: cache-first
  if (url.includes('cdnjs.cloudflare.com') ||
      url.includes('fonts.googleapis.com') ||
      url.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        return fetch(e.request).then(function(r) {
          if (r && r.status === 200) {
            var clone = r.clone();
            caches.open(CACHE_NAME).then(function(c) { c.put(e.request, clone); });
          }
          return r;
        }).catch(function() { return cached; });
      })
    );
    return;
  }

  // Tudo o resto
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).catch(function() {
      return caches.match(e.request);
    })
  );
});

self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
