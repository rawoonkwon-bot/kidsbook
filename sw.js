// 앱 파일과 바코드 엔진을 기기에 저장해 두 번째 방문부터 즉시 실행
const CACHE = "kbc-v105";
// 바코드 엔진(JS+WASM)은 버전 고정 주소라 업데이트해도 지우지 않는 별도 보관함에 둠
const LIB_CACHE = "kbc-lib-v1";
const ASSETS = ["/", "/index.html", "/styles.css", "/app.js", "/scanner.js", "/lookup.js", "/isbn.js", "/sync.js", "/icons.js", "/faces.js", "/math.js", "/rich.js", "/textbook.js", "/ws.css", "/ws.html",
  "/icon.svg", "/logo.svg", "/faces.svg", "/manifest.webmanifest"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== LIB_CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // 바코드 엔진(jsDelivr JS + fastly WASM, 버전 고정)은 캐시 우선 → 한 번 받으면 업데이트 후에도 바로 인식
  if (url.hostname === "cdn.jsdelivr.net" || url.hostname === "fastly.jsdelivr.net") {
    e.respondWith(caches.open(LIB_CACHE).then((c) => c.match(e.request).then((r) => r ||
      fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return; // 도서 조회는 항상 네트워크
  // 앱 코드는 네트워크 우선(업데이트 반영), 실패 시 캐시
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
