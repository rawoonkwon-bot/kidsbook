// 제목으로 책 찾기 (바코드로 못 찾은 책의 표지·쪽수를 다른 판에서 빌려 오기)
// 카카오(한글책) + Open Library + Google Books 에 동시에 물어서 후보를 합쳐 돌려줌
const https = (u) => (u || "").replace(/^http:\/\//, "https://");
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error("timeout")), ms))]);

async function kakao(q, key) {
  if (!key) return [];
  const r = await fetch(`https://dapi.kakao.com/v3/search/book?target=title&size=5&query=${encodeURIComponent(q)}`,
    { headers: { Authorization: `KakaoAK ${key}` } });
  if (!r.ok) return [];
  return ((await r.json()).documents || []).map((d) => ({
    title: d.title, authors: d.authors || [], publisher: d.publisher || "", cover: https(d.thumbnail), pages: null, source: "카카오",
  }));
}
async function openLibrary(q) {
  const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=6&fields=title,author_name,publisher,cover_i,number_of_pages_median`);
  if (!r.ok) return [];
  return ((await r.json()).docs || []).map((d) => ({
    title: d.title, authors: (d.author_name || []).slice(0, 2), publisher: d.publisher?.[0] || "",
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : "", pages: d.number_of_pages_median || null, source: "Open Library",
  }));
}
async function google(q) {
  const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=6&printType=books`);
  if (!r.ok) return [];
  return ((await r.json()).items || []).map(({ volumeInfo: v = {} }) => ({
    title: v.subtitle ? `${v.title}: ${v.subtitle}` : v.title, authors: v.authors || [], publisher: v.publisher || "",
    cover: https(v.imageLinks?.thumbnail || ""), pages: v.pageCount || null, source: "Google Books",
  }));
}

export default async function handler(req, res) {
  const q = String(req.query.q || "").trim().slice(0, 100);
  if (q.length < 2) return res.status(400).json({ error: "short query" });
  const key = (process.env.KAKAO_REST_KEY || "").trim();
  const korean = /[가-힣]/.test(q);
  const jobs = korean ? [kakao(q, key), openLibrary(q), google(q)] : [openLibrary(q), google(q), kakao(q, key)];
  const lists = await Promise.all(jobs.map((p) => withTimeout(p, 5000).catch(() => [])));
  const seen = new Set(), out = [];
  for (const list of lists) for (const b of list) {
    if (!b.title) continue;
    const k = `${b.title.toLowerCase()}|${b.pages || ""}|${b.cover ? 1 : 0}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(b);
  }
  // 표지와 쪽수가 둘 다 있는 후보를 앞으로
  out.sort((a, b) => (!!b.cover + !!b.pages) - (!!a.cover + !!a.pages));
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  return res.status(200).json({ results: out.slice(0, 8) });
}
