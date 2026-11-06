/* ExcelEx ERP service worker — makes the ERP installable and quick to open, WITHOUT ever serving stale data:
 *  - pages: always fetched fresh from the server; only when the phone is offline, a friendly offline screen
 *  - /assets/* (hashed file names, never change): cached after first use → instant start
 *  - /api, /auth, uploads, downloads: never touched (always live)                                        */
const SHELL = 'exl-shell-v1';
const ASSETS = 'exl-assets-v1';
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/offline.html', '/icons/icon-192.png'])));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![SHELL, ASSETS].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && /^\/(api|auth|downloads|uploads)\//.test(url.pathname)) return; // live data only
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  const isAsset = (sameOrigin && url.pathname.startsWith('/assets/')) || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!isAsset) return;
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) { const c = await caches.open(ASSETS); c.put(req, res.clone()); }
    return res;
  })());
});
