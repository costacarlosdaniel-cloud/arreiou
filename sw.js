const CACHE_NAME = 'karta-nova-20260516001';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/data.js', '/ui.js', '/firebase.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS).catch(()=>{}))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (e.request.method !== 'GET' || url.includes('docs.google.com') || url.includes('googleapis.com') || url.includes('gstatic.com/firebasejs')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request,{cache:'no-store'}).then(r => { const c=r.clone(); caches.open(CACHE_NAME).then(x=>x.put('/index.html',c)); return r; }).catch(()=>caches.match('/index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).then(r => { if(r && r.ok){ const c=r.clone(); caches.open(CACHE_NAME).then(x=>x.put(e.request,c)); } return r; })));
});
