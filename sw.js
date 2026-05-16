const CACHE_NAME = 'karta-v2-modular-002';
const ASSETS = [
  './', './index.html', './manifest.json',
  './css/base.css', './css/layout.css', './css/mobile.css',
  './js/app.js', './js/firebase.js', './js/auth.js', './js/firestore.js', './js/navigation.js', './js/ui.js',
  './modules/dashboard.js', './modules/stores.js', './modules/kpis.js', './modules/inventory.js', './modules/settings.js',
  './assets/icon-192.png', './assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS).catch(() => null)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (
    url.includes('googleapis.com') ||
    url.includes('gstatic.com/firebasejs') ||
    url.includes('firestore.googleapis.com') ||
    url.includes('identitytoolkit.googleapis.com')
  ) return;

  event.respondWith(
    fetch(event.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return res;
    }).catch(() => caches.match(event.request))
  );
});
