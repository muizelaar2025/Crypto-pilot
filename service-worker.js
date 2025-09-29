self.addEventListener("install", event => {
  event.waitUntil(
    caches.open("crypto-pilot-cache").then(cache => {
      return cache.addAll([
        "/",
        "/index.html",
        "/app.js",
        "/manifest.json",
        "/icon.png"
      ]);
    })
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
