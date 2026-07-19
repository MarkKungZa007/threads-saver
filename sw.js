const CACHE_NAME = "threads-saver-v3";
const ASSETS = [
  "index.html",
  "index.css",
  "app.js",
  "manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  // Bypass caching completely on localhost / 127.0.0.1
  if (url.includes("localhost") || url.includes("127.0.0.1")) {
    return;
  }
  
  if (e.request.method !== "GET" || !url.startsWith(self.location.origin)) {
    return;
  }
  
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).then((fetchResponse) => {
        if (fetchResponse.status === 200) {
          const responseClone = fetchResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseClone);
          });
        }
        return fetchResponse;
      }).catch(() => {
        return new Response("Offline mode active.");
      });
    })
  );
});
