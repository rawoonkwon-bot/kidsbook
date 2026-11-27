// 흘려듣기: 유튜브 주소를 붙여넣으면 영상 제목·채널·썸네일을 가져옴 (유튜브 oEmbed, 열쇠 필요 없음)
const ID = /^[A-Za-z0-9_-]{11}$/;
function videoId(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  if (host === "youtu.be") return ID.test(u.pathname.slice(1, 12)) ? u.pathname.slice(1, 12) : null;
  if (host !== "youtube.com") return null;
  const v = u.searchParams.get("v");
  if (v && ID.test(v)) return v;
  const m = u.pathname.match(/^\/(shorts|live|embed)\/([A-Za-z0-9_-]{11})/);
  return m ? m[2] : null;
}
function channelHandle(raw) {
  try {
    const u = new URL(raw.trim());
    if (u.hostname.replace(/^(www|m)\./, "") !== "youtube.com") return null;
    const m = u.pathname.match(/^\/@([^/]{2,60})/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  let raw = String(req.query.url || "").trim().slice(0, 300);
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  const id = videoId(raw);
  if (!id) {
    const h = channelHandle(raw);
    if (h) return res.status(200).json({ kind: "channel", title: h, channel: h, cover: "" });
    return res.status(400).json({ error: "not youtube" });
  }
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}`);
    if (!r.ok) return res.status(404).json({ error: `oembed ${r.status}` });
    const d = await r.json();
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({
      kind: "video", id,
      title: String(d.title || "").slice(0, 200),
      channel: String(d.author_name || "").slice(0, 100),
      cover: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    });
  } catch {
    return res.status(502).json({ error: "fail" });
  }
}
