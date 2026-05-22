/* InstaPort TMS — Service Worker v1.2
   Strategy: Cache-first for static assets, network-first for API/Supabase
*/
const CACHE = 'instaport-v1.2';
const STATIC = ['./index.html', './logo.png', './manifest.json'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      return c.addAll(STATIC);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  // Never intercept: POST requests, Supabase API, server API, Chrome extensions
  if (e.request.method !== 'GET') return;
  if (url.includes('supabase.co')) return;
  if (url.includes('/api/')) return;
  if (url.startsWith('chrome-extension')) return;

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      // Serve from cache instantly, update in background (stale-while-revalidate)
      var fetchPromise = fetch(e.request).then(function(response) {
        if (response && response.status === 200 && response.type !== 'opaque') {
          var clone = response.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return response;
      }).catch(function() { return cached; });
      return cached || fetchPromise;
    })
  );
});

self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
