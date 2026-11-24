// 앱 파일과 바코드 엔진을 기기에 저장해 두 번째 방문부터 즉시 실행
const CACHE = "kbc-v29";
const ASSETS = ["/", "/index.html", "/styles.css", "/app.js", "/scanner.js", "/lookup.js", "/isbn.js", "/sync.js", "/icons.js",
  "/icon.svg", "/logo.svg", "/faces.svg", "/manifest.webmanifest"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // 바코드 엔진(jsDelivr, 버전 고정)은 캐시 우선 → 두 번째 방문부터 즉시 로딩
  if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(caches.open(CACHE).then((c) => c.match(e.request).then((r) => r ||
      fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return; // 도서 조회는 항상 네트워크
  // 앱 코드는 네트워크 우선(업데이트 반영), 실패 시 캐시
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
