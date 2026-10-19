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
