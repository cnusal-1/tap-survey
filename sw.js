/* 두들김 조사 기록 — 오프라인 캐시
 *
 * 교량 하부는 통신이 안 되는 곳이 많다. 한 번 연 뒤로는 신호 없이도 열려야 하고,
 * 조사 도중 실수로 새로고침해도 앱이 살아나야 한다.
 *
 * 전략: 캐시 우선 + 뒤에서 갱신(stale-while-revalidate).
 *   · 화면은 즉시 캐시에서 뜬다 — 신호가 없어도, 느려도
 *   · 같은 요청을 뒤에서 다시 받아 다음 실행 때 최신이 된다
 *   · 깃허브 API 는 건드리지 않는다. 업로드는 항상 실제 요청이어야 한다
 */
const CACHE = "tapsurvey-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  /* 업로드 경로는 절대 가로채지 않는다 — 캐시된 응답이 성공으로 보이면 안 된다 */
  if (url.hostname === "api.github.com") return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });

    const fromNet = fetch(req).then((res) => {
      /* opaque(폰트 CDN)도 담는다. 상태를 못 읽을 뿐 쓸 수는 있다 */
      if (res && (res.ok || res.type === "opaque")) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    }).catch(() => null);

    if (hit) { fromNet; return hit; }          /* 캐시 먼저, 갱신은 뒤에서 */

    const res = await fromNet;
    if (res) return res;

    /* 오프라인인데 캐시에도 없다 — 화면 이동이면 시작 페이지로 대신 답한다 */
    if (req.mode === "navigate") {
      const idx = (await cache.match("./")) || (await cache.match("./index.html"));
      if (idx) return idx;
    }
    return new Response("오프라인이고 캐시에도 없다.", {
      status: 504, headers: { "Content-Type": "text/plain;charset=utf-8" },
    });
  })());
});
