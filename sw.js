/* Service Worker: cachea toda la app para funcionar 100% offline */
const CACHE = 'pokayoke-v4';
const ARCHIVOS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/datos.js',
  './js/lib/qrcode.min.js',
  './js/lib/lz-string.min.js',
  './manifest.json',
  './iconos/icono-192.png',
  './iconos/icono-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache primero (offline-first); si hay red, actualiza el cache en segundo plano
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(enCache => {
      const deRed = fetch(e.request).then(resp => {
        if (resp && resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copia));
        }
        return resp;
      }).catch(() => enCache);
      return enCache || deRed;
    })
  );
});
