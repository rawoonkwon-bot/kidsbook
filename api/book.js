// 한글책 조회용 서버 함수 (카카오 책 검색)
// API 키는 Vercel 환경변수 KAKAO_REST_KEY에만 두고, 브라우저에는 노출하지 않음
export default async function handler(req, res) {
  const isbn = String(req.query.isbn || "").replace(/[^0-9X]/gi, "");
  if (!/^(\d{9}[\dX]|\d{13})$/i.test(isbn)) return res.status(400).json({ error: "bad isbn" });
  const key = (process.env.KAKAO_REST_KEY || "").trim();
  if (!key) return res.status(501).json({ error: "KAKAO_REST_KEY not set" });

  const r = await fetch(
    `https://dapi.kakao.com/v3/search/book?target=isbn&size=1&query=${isbn}`,
    { headers: { Authorization: `KakaoAK ${key}` } });
  if (!r.ok) return res.status(502).json({ error: `kakao ${r.status}` });
  const doc = (await r.json()).documents?.[0];
  if (!doc) return res.status(404).json({ error: "not found" });

  // 같은 책은 하루 동안 Vercel 엣지에 캐시 → 두 번째부터 매우 빠름
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  return res.status(200).json({
    title: doc.title,
    authors: doc.authors || [],
    publisher: doc.publisher || "",
    pages: null,
    cover: (doc.thumbnail || "").replace(/^http:\/\//, "https://"),
    description: doc.contents || "",
    link: doc.url || "",
    source: "카카오 책",
  });
}
