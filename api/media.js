// 흘려듣기: 영화·TV 이름으로 포스터 찾기 (TMDB)
// 열쇠(TMDB_TOKEN)는 Vercel 환경변수에만 있고 브라우저로는 보내지 않음
// This product uses the TMDB API but is not endorsed or certified by TMDB.
const IMG = "https://image.tmdb.org/t/p/w185";

export default async function handler(req, res) {
  const q = String(req.query.q || "").trim().slice(0, 100);
  if (q.length < 1) return res.status(400).json({ error: "short query" });
  const token = (process.env.TMDB_TOKEN || "").trim();
  if (!token) return res.status(200).json({ results: [], error: "no key" });
  try {
    const u = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(q)}&language=ko-KR&include_adult=false&page=1`;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } });
    if (!r.ok) return res.status(200).json({ results: [], error: `tmdb ${r.status}` });
    const list = ((await r.json()).results || [])
      .filter((x) => (x.media_type === "movie" || x.media_type === "tv") && !x.adult)
      .slice(0, 10)
      .map((x) => ({
        id: x.id,
        kind: x.media_type === "tv" ? "TV" : "영화",
        title: x.title || x.name || "",
        original: x.original_title || x.original_name || "",
        year: (x.release_date || x.first_air_date || "").slice(0, 4),
        cover: x.poster_path ? IMG + x.poster_path : "",
      }));
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({ results: list });
  } catch {
    return res.status(200).json({ results: [], error: "fail" });
  }
}
