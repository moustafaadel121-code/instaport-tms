/* InstaPort TMS — Service Worker v1.3
   Strategy: Network-first for HTML, cache-first for static assets
*/
const CACHE = 'instaport-v1.3';
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

  // Always fetch HTML from network (never serve stale index.html)
  if (url.endsWith('/') || url.endsWith('/index.html') || url.includes('index.html')) {
    e.respondWith(
      fetch(e.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return response;
      }).catch(function() { return caches.match(e.request); })
    );
    return;
  }

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
