// Service worker scanner: menyimpan aplikasi supaya bisa dibuka tanpa internet,
// dan mengirim scan tertunda di latar belakang begitu HP mendapat koneksi (Background Sync di Chrome Android).
const VERSION = "rpk-scan-v1";
const SHELL = [
  "/scan/",
  "/scan/scan.css",
  "/scan/app.js",
  "/scan/store.js",
  "/scan/manifest.webmanifest",
  "/scan/icon-192.png",
  "/scan/icon-512.png",
  "/vendor/jsQR.js",
];

importScripts("/scan/store.js");

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // data selalu langsung ke server
  const isShell = url.pathname === "/scan" || url.pathname.startsWith("/scan/") || url.pathname === "/vendor/jsQR.js";
  if (!isShell) return;
  const key = e.request.mode === "navigate" ? "/scan/" : url.pathname;
  // Ambil dari cache dulu (cepat & offline), lalu perbarui cache di belakang bila ada koneksi.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(key);
    const network = fetch(e.request).then((res) => {
      if (res.ok && res.type === "basic") cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    return (await network) || new Response("Aplikasi belum tersimpan. Buka sekali saat ada internet.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  })());
});

self.addEventListener("sync", (e) => {
  if (e.tag !== "rpk-sync") return;
  e.waitUntil((async () => {
    try {
      const r = await self.RPKStore.syncNow();
      for (const c of await self.clients.matchAll()) c.postMessage({ type: "synced", result: r });
    } catch (err) {
      // Lempar ulang supaya Chrome mencoba lagi nanti, kecuali masalah login.
      if (err && err.code !== "auth") throw err;
    }
  })());
});
