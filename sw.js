const CACHE = "chi-tieu-v1";
const ASSETS = ["./index.html", "./app.js", "./style.css", "./manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  // Chỉ cache GET, bỏ qua Google API
  if (e.request.method !== "GET") return;
  if (e.request.url.includes("googleapis.com") || e.request.url.includes("accounts.google.com")) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
