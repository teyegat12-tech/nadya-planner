// Офлайн-оболочка: приложение открывается даже без интернета
const CACHE = 'planner-v2';
const SHELL = ['/', '/index.html', '/styles.css', '/dark.css', '/js/app.js', '/js/db.js', '/js/dates.js', '/js/config.js', '/js/fx.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.hostname.endsWith('supabase.co')) return;
  // сначала сеть (чтобы всегда была свежая версия), без сети — из кэша
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && (url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
  );
});
