const CACHE_NAME = 'mt-topup-pwa-v1.2';
const ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/admin.html',
  '/style.css',
  '/app.js',
  '/logo.png'
];

// Install Event
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Catch additions to cache gracefully if some assets are not fully present yet
      return cache.addAll(ASSETS).catch((err) => console.log('Caching assets error: ', err));
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event (Network-first falling back to cache approach)
self.addEventListener('fetch', (e) => {
  // Avoid intercepting POST requests or APIs
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) {
    return;
  }
  
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Cache new successful GET responses
        if (res.status === 200) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, resClone);
          });
        }
        return res;
      })
      .catch(() => {
        // Fallback to cache if network is offline
        return caches.match(e.request);
      })
  );
});
