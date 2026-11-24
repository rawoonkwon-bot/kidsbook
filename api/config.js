// 브라우저가 Supabase에 접속할 주소와 공개 키(publishable)를 알려 줌
// 값은 Vercel 환경변수 SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY 에만 둠 (비밀 키는 절대 여기 두지 않음)
export default function handler(req, res) {
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!url || !key) return res.status(501).json({ error: "not set" });
  res.setHeader("Cache-Control", "public, s-maxage=300");
  return res.status(200).json({ url, key });
}
