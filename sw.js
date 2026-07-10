// Service Worker for DMP Attendance
const CACHE_NAME = 'dmp-attendance-v2';

self.addEventListener('install', (e) => {
  // Skip waiting so new SW activates immediately
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll([
        '.',
        'index.html',
        'css/style.css',
        'js/app.js',
        'manifest.json',
        'logo.png'
      ]).catch(() => {});
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => {
      // Take control of all clients so updates apply
      return self.clients.claim();
    })
  );
});

// Network-first strategy for fresh content, cache fallback for offline
self.addEventListener('fetch', (e) => {
  // Only handle GET requests for our app
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Cache successful responses
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(e.request, clone);
        });
        return response;
      })
      .catch(() => {
        // Offline: serve from cache
        return caches.match(e.request);
      })
  );
});

// Notify clients when a new service worker is available
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
