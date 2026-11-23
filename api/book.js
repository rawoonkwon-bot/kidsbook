// 책 조회용 서버 함수: 카카오 책 검색 + 알라딘(쪽수 정보)
// API 키는 Vercel 환경변수(KAKAO_REST_KEY, ALADIN_TTB_KEY)에만 두고, 브라우저에는 노출하지 않음
const https = (u) => (u || "").replace(/^http:\/\//, "https://");

async function fromKakao(isbn, key) {
  const r = await fetch(`https://dapi.kakao.com/v3/search/book?target=isbn&size=1&query=${isbn}`,
    { headers: { Authorization: `KakaoAK ${key}` } });
  if (!r.ok) throw new Error(`kakao ${r.status}`);
  const doc = (await r.json()).documents?.[0];
  if (!doc) return null;
  return {
    title: doc.title, authors: doc.authors || [], publisher: doc.publisher || "", pages: null,
    cover: https(doc.thumbnail), description: doc.contents || "", link: doc.url || "", source: "카카오 책",
  };
}

async function fromAladin(isbn, key) {
  const type = isbn.length === 13 ? "ISBN13" : "ISBN";
  const r = await fetch(`https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?ttbkey=${key}&itemIdType=${type}&ItemId=${isbn}&output=js&Version=20131101&Cover=Big`);
  if (!r.ok) throw new Error(`aladin ${r.status}`);
  const text = (await r.text()).trim().replace(/;$/, "");
  const it = JSON.parse(text).item?.[0];
  if (!it) return null;
  return {
    title: it.title, authors: it.author ? [it.author.replace(/\s*\([^)]*\)/g, "").trim()] : [], publisher: it.publisher || "",
    pages: it.subInfo?.itemPage || null, cover: https(it.cover), description: it.description || "", link: https(it.link), source: "알라딘",
  };
}

export default async function handler(req, res) {
  const isbn = String(req.query.isbn || "").replace(/[^0-9X]/gi, "");
  if (!/^(\d{9}[\dX]|\d{13})$/i.test(isbn)) return res.status(400).json({ error: "bad isbn" });
  const kakaoKey = (process.env.KAKAO_REST_KEY || "").trim();
  const aladinKey = (process.env.ALADIN_TTB_KEY || "").trim();
  if (!kakaoKey && !aladinKey) return res.status(501).json({ error: "no api key set" });

  // 두 곳에 동시에 묻기
  const [k, a] = await Promise.allSettled([
    kakaoKey ? fromKakao(isbn, kakaoKey) : Promise.resolve(null),
    aladinKey ? fromAladin(isbn, aladinKey) : Promise.resolve(null),
  ]);
  const kb = k.status === "fulfilled" ? k.value : null;
  const ab = a.status === "fulfilled" ? a.value : null;
  if (!kb && !ab) return res.status(404).json({ error: "not found" });

  // 기본 정보는 카카오, 쪽수는 알라딘 (카카오가 없으면 알라딘 정보 그대로)
  const book = kb ? { ...kb, pages: ab?.pages || null, description: kb.description || ab?.description || "" } : ab;
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  return res.status(200).json(book);
}
