// 최소 service worker: 이 사이트 파일(index.html 등)은 network-first, 오프라인이면 마지막 사본.
// Supabase 요청(*.supabase.co)과 다른 출처(CDN, 글꼴)는 가로채지 않음 → 캐시 안 함.
var CACHE = 'ddw-v1';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (/supabase\.(co|in)$/.test(url.hostname) || url.origin !== self.location.origin) return;
  if (/^\/(rest|auth|storage|functions)\/v1\//.test(url.pathname)) return; // Supabase API 경로도 캐시 금지
  e.respondWith(fetch(req).then(function (res) {
    if (!res.ok) return res;
    var copy = res.clone();
    return caches.open(CACHE).then(function (c) { return c.put(req, copy); }).then(function () { return res; }, function () { return res; });
  }, function () {
    return caches.match(req).then(function (r) { return r || Promise.reject(new Error('offline')); });
  }));
});

// 웹 푸시 (2026-11-23): Edge Function notify가 보낸 {title, body, tag, url}을 알림으로. 누르면 열린 앱 창으로, 없으면 새로 열기
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '라켓뚱보단', {
    body: d.body || '', tag: d.tag || 'ddw', renotify: true, icon: 'icons/icon-192.png', data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) if (cs[i].url.indexOf(self.registration.scope) === 0 && 'focus' in cs[i]) return cs[i].focus();
    return self.clients.openWindow(url);
  }));
});
