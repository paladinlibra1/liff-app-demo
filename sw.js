const CACHE_NAME = "cf-shell-v4";
const SHELL_FILES = [
  "./index.html",
  "./my-bookings.html",
  "./admin.html",
  "./config.js",
  "./manifest.json",
  "./manifest-admin.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/admin-icon-192.png",
  "./icons/admin-icon-512.png",
  "./icons/admin-apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Only handle same-origin GET requests for the static app shell.
// Firebase / LINE LIFF / GAS calls always go straight to the network so booking data stays live.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    // cache: 'no-store' 強制略過瀏覽器自己的 HTTP 快取，確保每次都真的問到伺服器最新版本，
    // 不然「加入主畫面」後開啟常會停在舊版（fetch() 預設仍可能吃到 HTTP 層快取，不會真的發網路請求）
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request))
  );
});
