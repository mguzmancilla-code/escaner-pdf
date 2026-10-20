// Service worker: guarda la app en caché para que funcione sin conexión.
// Sube VERSION cada vez que publiques cambios.
const VERSION = 'v36';
const CACHE = `escaner-pdf-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/auth.js',
  'js/config.js',
  'js/cloud.js',
  'js/pdftext.js',
  'js/pdfedit.js',
  'js/office.js',
  'js/vendor/fflate.js',
  'js/vendor/pdf-lib.esm.min.js',
  'js/vendor/pdfjs/pdf.min.mjs',
  'js/vendor/pdfjs/pdf.worker.min.mjs',
  'js/vendor/supabase.js',
  'js/db.js',
  'js/imaging.js',
  'js/pdf.js',
  'js/opencv.js',
  'icons/logo.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Responde desde la caché al instante y la actualiza en segundo plano.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  // Librerías de terceros (js/vendor/): no cambian dentro de una versión, así que
  // se sirven desde la caché sin volver a descargarlas (OpenCV pesa ~10 MB).
  if (new URL(request.url).pathname.includes('/js/vendor/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached ?? (request.mode === 'navigate' ? cache.match('index.html') : Response.error()));
      if (cached) {
        event.waitUntil(network.then(() => {}, () => {}));
        return cached;
      }
      return network;
    }),
  );
});
