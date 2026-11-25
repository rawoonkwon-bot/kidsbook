// 책 조회용 서버 함수: 카카오 책 검색 + 국립중앙도서관/알라딘(쪽수 정보)
// API 키는 Vercel 환경변수(KAKAO_REST_KEY, NL_CERT_KEY, ALADIN_TTB_KEY)에만 두고, 브라우저에는 노출하지 않음
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
    category: aladinCat(it.categoryName),
  };
}

// 알라딘 분류 예) "국내도서>어린이>과학/수학/컴퓨터>과학" → 분야 (큰 묶음 이름은 빼고 봄)
const CAT_RULES = [
  ["문학", /소설|동화|문학|시집|그림책|만화|명작|고전|에세이|희곡|fiction|literature|picture book|comic/i],
  ["역사", /역사|위인|전기|인물|history|biograph/i],
  ["자연과학", /과학|자연|동물|식물|수학|우주|생물|지구|science|math|nature/i],
  ["예술", /예술|미술|음악|대중문화|art|music/i],
  ["언어", /언어|한글|영어|국어|외국어|어휘|사전|language|english/i],
  ["사회과학", /사회|가족|학교|경제|정치|법|교육|문화|society|econom/i],
  ["기술과학", /기술|요리|건강|공학|컴퓨터|IT|자동차|technolog|cook|health|computer/i],
  ["종교", /종교|성경|불교|기독교|religio|bible/i],
  ["철학", /철학|심리|윤리|philosoph|psycholog/i],
];
function aladinCat(name) {
  const parts = String(name || "").split(">").slice(1).filter((x) => !/^(어린이|유아|청소년|초등|중고등|외국도서|국내도서|어린이 영어|ELT|기타)/.test(x.trim()));
  const text = parts.join(" | ");
  if (!text) return "";
  for (const [n, re] of CAT_RULES) if (re.test(text)) return n;
  return "";
}

// 국립중앙도서관 KDC(한국십진분류) 첫 자리 → 분야
const KDC = ["총류", "철학", "종교", "사회과학", "자연과학", "기술과학", "예술", "언어", "문학", "역사"];
const kdcName = (k) => { const m = String(k || "").match(/\d/); return m ? KDC[Number(m[0])] : ""; };
const addCodeCat = (c) => { const m = String(c || "").match(/^\d{5}$/); return m ? KDC[Number(m[0][2])] : ""; };

// 국립중앙도서관 ISBN 서지정보: PAGE 값 예) "312 p.", "48p" → 숫자만
async function fromNL(isbn, key) {
  const r = await fetch(`https://www.nl.go.kr/seoji/SearchApi.do?cert_key=${encodeURIComponent(key)}&result_style=json&page_no=1&page_size=1&isbn=${isbn}`,
    { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`nl ${r.status}`);
  const doc = (await r.json()).docs?.[0];
  if (!doc) return null;
  const m = String(doc.PAGE || "").match(/\d+/);
  const pages = m ? parseInt(m[0], 10) : null;
  return {
    title: doc.TITLE || "", authors: doc.AUTHOR ? [doc.AUTHOR] : [], publisher: doc.PUBLISHER || "",
    pages: pages && pages < 5000 ? pages : null, cover: https(doc.TITLE_URL || ""), description: doc.BOOK_SUMMARY || doc.BOOK_INTRODUCTION || "",
    // 분야: KDC 가 없으면 부가기호(5자리, 셋째 자리 = 내용분류 첫 숫자)로
    category: kdcName(doc.KDC) || addCodeCat(doc.EA_ADD_CODE) || addCodeCat(doc.SET_ADD_CODE), link: "", source: "국립중앙도서관",
  };
}

export default async function handler(req, res) {
  const isbn = String(req.query.isbn || "").replace(/[^0-9X]/gi, "");
  if (!/^(\d{9}[\dX]|\d{13})$/i.test(isbn)) return res.status(400).json({ error: "bad isbn" });
  const kakaoKey = (process.env.KAKAO_REST_KEY || "").trim();
  const aladinKey = (process.env.ALADIN_TTB_KEY || "").trim();
  const nlKey = (process.env.NL_CERT_KEY || "").trim();
  if (!kakaoKey && !aladinKey && !nlKey) return res.status(501).json({ error: "no api key set" });

  // 세 곳에 동시에 묻기
  const [k, a, n] = await Promise.allSettled([
    kakaoKey ? fromKakao(isbn, kakaoKey) : Promise.resolve(null),
    aladinKey ? fromAladin(isbn, aladinKey) : Promise.resolve(null),
    nlKey ? fromNL(isbn, nlKey) : Promise.resolve(null),
  ]);
  const val = (x) => (x.status === "fulfilled" ? x.value : null);
  const kb = val(k), ab = val(a), nb = val(n);
  if (!kb && !ab && !nb) return res.status(404).json({ error: "not found" });

  // 기본 정보는 카카오 → 알라딘 → 국립중앙도서관 순, 쪽수는 국립중앙도서관 또는 알라딘
  const base = kb || ab || nb;
  const book = { ...base, pages: nb?.pages || ab?.pages || base.pages || null, category: nb?.category || ab?.category || base.category || "",
    description: base.description || ab?.description || nb?.description || "" };
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  return res.status(200).json(book);
}
