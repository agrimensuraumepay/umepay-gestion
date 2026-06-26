// Service worker mínimo: permite instalar la app y que funcione básico sin internet.
// Estrategia: para archivos propios (HTML/CSS/íconos) intenta la red y si no hay,
// usa la copia guardada. NO toca las llamadas a Google (Apps Script) ni los POST.
const CACHE = 'umepay-v1';
const ASSETS = ['./', './index.html', './presupuestos.html',
  './logo-umepay.svg', './icon-192.png', './icon-512.png', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // los guardados (POST) van directo a Google
  if (new URL(req.url).origin !== location.origin) return; // no interferir con Apps Script ni fuentes
  e.respondWith(
    fetch(req)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
