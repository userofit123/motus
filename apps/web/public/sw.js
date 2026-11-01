// Motus's service worker: makes the web app installable and lets it open without a connection.
// Pages: the network first, the last copy when offline. Built files (hashed names, never change): from the cache.
// Your data is not cached here (the app keeps its own copy of it, api/replica.ts); photos are, once seen, so they show
// offline too. In development nothing is cached at all.
const CACHE = "motus-v2";
const DEV = (p) => p.startsWith("/@") || p.startsWith("/src/") || p.startsWith("/node_modules/") || p.includes("?t=") || p.includes("?v=");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || DEV(u.pathname + u.search)) return;
  const photo = u.pathname.startsWith("/api/media/") || u.pathname.startsWith("/exercise-images/");
  if (u.pathname.startsWith("/api/") && !photo) return;
  if (r.mode === "navigate") {
    e.respondWith(fetch(r).then((res) => { const c = res.clone(); caches.open(CACHE).then((cc) => cc.put("/", c)); return res; })
      .catch(() => caches.match("/").then((m) => m ?? Response.error())));
    return;
  }
  if (photo || u.pathname.startsWith("/assets/") || u.pathname.startsWith("/fonts/") || /\.(png|svg|woff2?)$/.test(u.pathname)) {
    e.respondWith(caches.match(r).then((m) => m ?? fetch(r).then((res) => {
      if (res.ok) { const c = res.clone(); caches.open(CACHE).then((cc) => cc.put(r, c)); }
      return res;
    })));
  }
});
