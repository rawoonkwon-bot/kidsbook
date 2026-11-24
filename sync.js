// 로그인(이메일)과 기록 동기화 — Supabase
// 기록은 휴대폰(localStorage)에 먼저 저장하고, 로그인돼 있으면 잠시 뒤 계정(userdata 표)에 올림
const LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm";
const KEYS = { kids: "kbc:kids:v1", cats: "kbc:cats:v1", records: "kbc:records:v1", journal: "kbc:journal:v1" };
const SYNCED = new Set(Object.values(KEYS));
const CFG = "kbc:sbcfg", SUSER = "kbc:syncUser", SAT = "kbc:syncedAt", DIRTY = "kbc:dirty", EMAIL = "kbc:email";

// 비밀번호 재설정 메일 링크로 들어왔는지 (Supabase가 주소를 정리하기 전에 확인)
export const RECOVERY = /type=recovery/.test(location.hash);

let sb = null, user = null, isPublic = true, timer = null, pushing = null, edits = 0;
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error("timeout")), ms))]);

async function client() {
  if (sb) return sb;
  let cfg = readJSON(CFG, null);
  try {
    const r = await withTimeout(fetch("/api/config", { cache: "no-store" }), 5000);
    if (r.ok) { cfg = await r.json(); localStorage.setItem(CFG, JSON.stringify(cfg)); }
  } catch { /* 오프라인이면 저장해 둔 설정 사용 */ }
  if (!cfg?.url || !cfg?.key) throw new Error("no config");
  const { createClient } = await withTimeout(import(LIB), 10000);
  sb = createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" } });
  return sb;
}

// ---------- 휴대폰 기록 읽기 / 쓰기 ----------
function readLocal() {
  return { kids: readJSON(KEYS.kids, []), cats: readJSON(KEYS.cats, null), records: readJSON(KEYS.records, []), journal: readJSON(KEYS.journal, []) };
}
function writeLocal(d) {
  localStorage.setItem(KEYS.kids, JSON.stringify(d.kids || []));
  if (d.cats) localStorage.setItem(KEYS.cats, JSON.stringify(d.cats)); else localStorage.removeItem(KEYS.cats);
  localStorage.setItem(KEYS.records, JSON.stringify(d.records || []));
  localStorage.setItem(KEYS.journal, JSON.stringify(d.journal || []));
}
// '나만보기'(비밀 메모)는 공개 기록(userdata)에 넣지 않고, 나만 읽을 수 있는 userprivate 표에 따로 저장
const isSecret = (j) => j.cat === "secret";
const withSecrets = (d, priv) => ({ ...(d || {}), journal: [...((d || {}).journal || []).filter((j) => !isSecret(j)), ...((priv?.data?.journal) || [])] });
const hasData = (d) => (d.kids?.length || 0) + (d.records?.length || 0) + (d.journal?.length || 0) > 0;

// 두 기록 합치기 (같은 자녀·같은 책·같은 날 기록은 한 번만)
function mergeData(base, extra) {
  const out = { kids: [...(base.kids || [])], cats: base.cats ? [...base.cats] : extra.cats || null,
    records: (base.records || []).map((r) => ({ ...r, sessions: [...(r.sessions || [])] })), journal: [...(base.journal || [])] };
  const kidMap = {};
  for (const k of extra.kids || []) {
    const same = out.kids.find((x) => x.id === k.id) || out.kids.find((x) => x.nick === k.nick);
    if (same) { kidMap[k.id] = same.id; if (same.grade == null && k.grade != null) { same.grade = k.grade; same.gradeYear = k.gradeYear; } }
    else { out.kids.push({ ...k }); kidMap[k.id] = k.id; }
  }
  if (out.cats && extra.cats) for (const c of extra.cats) if (!out.cats.some((x) => x.key === c.key)) out.cats.push({ ...c });
  const kidOf = (id) => (id && kidMap[id]) || id;
  const sKey = (s) => `${s.day}|${s.from ?? ""}|${s.to ?? ""}|${s.round || 1}`;
  for (const r of extra.records || []) {
    const kid = kidOf(r.kid);
    const same = out.records.find((x) => x.id === r.id) || out.records.find((x) => x.isbn && x.isbn === r.isbn && x.kid === kid);
    if (!same) { out.records.push({ ...r, kid }); continue; }
    const have = new Set(same.sessions.map(sKey));
    for (const s of r.sessions || []) if (!have.has(sKey(s))) same.sessions.push(s);
    for (const f of ["totalPages", "score", "note", "bonus", "category", "cover", "description"]) if (!same[f] && r[f]) same[f] = r[f];
    for (const f of r.finishes || []) if (!(same.finishes || []).some((x) => x.round === f.round)) same.finishes = [...(same.finishes || []), f];
    if (r.bonusRounds) same.bonusRounds = [...new Set([...(same.bonusRounds || []), ...r.bonusRounds])];
    if ((r.round || 1) > (same.round || 1)) { same.round = r.round; same.done = !!r.done; same.doneAt = r.doneAt; same.doneDay = r.doneDay; }
    else if (r.done && !same.done && (r.round || 1) === (same.round || 1)) { same.done = true; same.doneAt = r.doneAt; same.doneDay = r.doneDay; }
  }
  for (const j of extra.journal || []) if (!out.journal.some((x) => x.id === j.id)) out.journal.push({ ...j, kid: kidOf(j.kid) });
  return out;
}

// ---------- 계정에 올리기 ----------
async function pushNow() {
  if (!user || !sb) return;
  const startEdits = edits;
  const local = readLocal();
  const secrets = (local.journal || []).filter(isSecret);
  const pub = { ...local, journal: (local.journal || []).filter((j) => !isSecret(j)) };
  const { error: e2 } = await sb.from("userprivate").upsert({ user_id: user.id, data: { journal: secrets } }, { onConflict: "user_id" });
  if (e2) throw e2;
  const { data, error } = await sb.from("userdata").upsert({ user_id: user.id, data: pub }, { onConflict: "user_id" })
    .select("updated_at, is_public").single();
  if (error) throw error;
  localStorage.setItem(SAT, data.updated_at);
  isPublic = data.is_public;
  if (edits === startEdits) localStorage.removeItem(DIRTY);
}
export function flush() {
  clearTimeout(timer); timer = null;
  if (!localStorage.getItem(DIRTY) || !user) return Promise.resolve();
  pushing = (pushing || Promise.resolve()).then(async () => { try { await client(); await pushNow(); } catch { /* 다음에 다시 */ } });
  return pushing;
}
// 앱이 기록을 저장할 때마다 불림
export function touched(key) {
  if (!SYNCED.has(key) || !localStorage.getItem(SUSER)) return;
  edits++;
  localStorage.setItem(DIRTY, "1");
  clearTimeout(timer);
  timer = setTimeout(flush, 1500);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
window.addEventListener("online", () => flush());

// ---------- 계정과 휴대폰 기록 맞추기 ----------
async function reconcile() {
  const [{ data: row0, error }, { data: priv, error: e2 }] = await Promise.all([
    sb.from("userdata").select("data, is_public, updated_at").eq("user_id", user.id).maybeSingle(),
    sb.from("userprivate").select("data").eq("user_id", user.id).maybeSingle(),
  ]);
  if (error) throw error;
  if (e2) throw e2;
  const row = row0 ? { ...row0, data: withSecrets(row0.data, priv) } : null;
  const local = readLocal();
  const su = localStorage.getItem(SUSER);
  if (row) isPublic = row.is_public;
  if (su !== user.id) {
    // 이 휴대폰에서 처음 로그인: 로그인 전에 쓰던 기록은 계정으로 옮기고, 다른 계정의 기록은 비움
    const mine = su ? { kids: [], cats: null, records: [], journal: [] } : local;
    const merged = row ? (hasData(mine) ? mergeData(row.data || {}, mine) : row.data || {}) : mine;
    writeLocal(merged);
    localStorage.setItem(SUSER, user.id);
    if (!row || hasData(mine)) { localStorage.setItem(DIRTY, "1"); await pushNow(); }
    else { localStorage.setItem(SAT, row.updated_at); localStorage.removeItem(DIRTY); }
    return;
  }
  if (!row) { localStorage.setItem(DIRTY, "1"); await pushNow(); return; }
  const newer = row.updated_at !== localStorage.getItem(SAT);
  const dirty = !!localStorage.getItem(DIRTY);
  if (newer && dirty) { writeLocal(mergeData(row.data || {}, local)); await pushNow(); }
  else if (newer) { writeLocal(row.data || {}); localStorage.setItem(SAT, row.updated_at); }
  else if (dirty) await pushNow();
}

// 앱 시작할 때: 로그인 확인 + 기록 맞추기
// 돌려주는 값: { user } 또는 { user: null } 또는 { user: null, error: true }(인터넷 없음)
export async function boot() {
  try {
    const c = await client();
    const { data } = await withTimeout(c.auth.getSession(), 6000);
    user = data.session?.user || null;
  } catch {
    const id = localStorage.getItem(SUSER);
    if (id) return { user: { id, email: localStorage.getItem(EMAIL) || "" }, offline: true };
    return { user: null, error: true };
  }
  if (!user) return { user: null };
  localStorage.setItem(EMAIL, user.email || "");
  try { await withTimeout(reconcile(), 10000); } catch { /* 인터넷이 느리면 휴대폰 기록으로 먼저 시작 */ }
  return { user };
}

// ---------- 로그인 · 가입 ----------
const KO_ERR = [
  [/invalid login credentials/i, "이메일이나 비밀번호가 맞지 않아요."],
  [/email not confirmed/i, "메일함에서 인증 링크를 먼저 눌러 주세요."],
  [/already registered|already been registered/i, "이미 가입된 이메일이에요. 로그인해 주세요."],
  [/password should be at least|weak password/i, "비밀번호는 6자 이상으로 해 주세요."],
  [/rate limit|too many|security purposes/i, "잠시 뒤에 다시 해 주세요."],
  [/invalid.*email|unable to validate email/i, "이메일 주소를 다시 확인해 주세요."],
];
export const koError = (e) => KO_ERR.find(([re]) => re.test(e?.message || ""))?.[1] || "문제가 생겼어요. 인터넷 연결을 확인하고 다시 해 주세요.";

export async function signIn(email, password) {
  const c = await client();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  user = data.user;
  localStorage.setItem(EMAIL, user.email || "");
  await withTimeout(reconcile(), 15000).catch(() => {});
}
// 가입: 인증 메일이 가면 true
export async function signUp(email, password) {
  const c = await client();
  const { data, error } = await c.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
  if (error) throw error;
  if (data.user && data.user.identities?.length === 0) throw new Error("already registered");
  if (data.session) { user = data.user; localStorage.setItem(EMAIL, user.email || ""); await withTimeout(reconcile(), 15000).catch(() => {}); return false; }
  return true;
}
export async function sendReset(email) {
  const c = await client();
  const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
  if (error) throw error;
}
export async function newPassword(password) {
  const c = await client();
  const { error } = await c.auth.updateUser({ password });
  if (error) throw error;
}
// 로그아웃: 먼저 올리고, 이 휴대폰의 기록은 비움(계정에 남아 있음)
export async function signOut() {
  await flush();
  if (localStorage.getItem(DIRTY)) throw new Error("unsynced");
  const c = await client();
  await c.auth.signOut();
  for (const k of [...SYNCED, SUSER, SAT, DIRTY, EMAIL, "kbc:activeKid"]) localStorage.removeItem(k);
}
export const currentEmail = () => user?.email || localStorage.getItem(EMAIL) || "";
export const unsynced = () => !!localStorage.getItem(DIRTY);

// ---------- 공개 · 둘러보기 ----------
export const getPublic = () => isPublic;
export async function setPublic(v) {
  const c = await client();
  await flush();
  const { error } = await c.from("userdata").update({ is_public: v }).eq("user_id", user.id);
  if (error) throw error;
  isPublic = v;
}
// 공개한 다른 집들의 자녀 목록
export async function listPublic() {
  const c = await client();
  const { data, error } = await c.from("userdata").select("user_id, kids:data->kids, updated_at")
    .eq("is_public", true).neq("user_id", user.id).order("updated_at", { ascending: false }).limit(80);
  if (error) throw error;
  return data || [];
}
// 한 집의 기록 (보기만)
export async function fetchUser(id) {
  const c = await client();
  const { data, error } = await c.from("userdata").select("data").eq("user_id", id).maybeSingle();
  if (error) throw error;
  return data?.data || null;
}

// ---------- 함께 쓰는 책 목록 (바코드로 못 찾은 책을 회원이 등록) ----------
export async function sharedBook(isbn) {
  if (!user || !/^\d{13}$/.test(isbn || "")) return null;
  const c = await client();
  const { data, error } = await c.from("books").select("title, authors, publisher, cover, pages").eq("isbn", isbn).maybeSingle();
  if (error || !data) return null;
  return { title: data.title, authors: data.authors ? data.authors.split(", ").filter(Boolean) : [], publisher: data.publisher || "",
    cover: data.cover || "", pages: data.pages || null, description: "", category: "", source: "회원이 등록한 책" };
}
export async function shareBook(b) {
  if (!user || !/^\d{13}$/.test(b.isbn || "") || !b.title) return;
  const c = await client();
  await c.from("books").upsert({ isbn: b.isbn, title: b.title.slice(0, 200), authors: (b.authors || "").slice(0, 200),
    publisher: (b.publisher || "").slice(0, 100), cover: /^https:\/\//.test(b.cover || "") ? b.cover.slice(0, 500) : "",
    pages: b.pages > 0 && b.pages < 5000 ? b.pages : null }, { onConflict: "isbn", ignoreDuplicates: true });
}

// ---------- 일기 사진 (비공개 보관함, 공개한 회원 것만 다른 사람도 볼 수 있음) ----------
const BUCKET = "photos";
const urlCache = new Map();
export const canUpload = () => !!user;
// folder: "private"(비밀 메모, 나만) · "board"(게시판, 회원 모두) · ""(일기, 공개 규칙 따름)
export async function uploadPhoto(blob, folder = "") {
  if (!user) throw new Error("login");
  const c = await client();
  if (folder === true) folder = "private";
  const path = `${user.id}/${folder ? `${folder}/` : ""}${crypto.randomUUID()}.jpg`;
  const { error } = await c.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return path;
}
// 사진 주소(1시간 동안 쓸 수 있는 링크)
export async function photoUrls(paths) {
  const need = paths.filter((p) => !urlCache.has(p));
  if (need.length && user) {
    try {
      const c = await client();
      const { data } = await c.storage.from(BUCKET).createSignedUrls(need, 3600);
      for (const d of data || []) if (d.signedUrl) urlCache.set(d.path, d.signedUrl);
    } catch { /* 인터넷 없음 */ }
  }
  return paths.map((p) => urlCache.get(p) || "");
}
export async function deletePhotos(paths) {
  const mine = (paths || []).filter((p) => user && p.startsWith(`${user.id}/`));
  if (!mine.length) return;
  try { const c = await client(); await c.storage.from(BUCKET).remove(mine); } catch { /* 다음에 */ }
}

// ---------- 엄마 별명 · 게시판 ----------
let profile = null, admin = false;
export const myNick = () => profile?.nick || "";
export const amAdmin = () => admin;
export const myId = () => user?.id || "";
// 별명이 없으면 null, 인터넷 문제로 모르면 예외
export async function loadProfile() {
  if (!user) return null;
  const c = await client();
  const [{ data: p, error }, { data: a }] = await Promise.all([
    c.from("profiles").select("nick").eq("user_id", user.id).maybeSingle(),
    c.from("admins").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  if (error) throw error;
  profile = p || null; admin = !!a;
  return profile;
}
export async function setNick(nick) {
  const c = await client();
  const { error } = await c.from("profiles").upsert({ user_id: user.id, nick }, { onConflict: "user_id" });
  if (error) throw new Error(error.code === "23505" ? "taken" : error.message);
  profile = { nick };
}
const cnt = (x) => (Array.isArray(x) ? x[0]?.count || 0 : 0);
export async function listPosts(board) {
  const c = await client();
  const { data, error } = await c.from("posts")
    .select("id, board, title, pinned, created_at, user_id, profiles(nick), comments(count), likes(count)")
    .eq("board", board).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(60);
  if (error) throw error;
  return (data || []).map((p) => ({ ...p, nick: p.profiles?.nick || "(알 수 없음)", nComments: cnt(p.comments), nLikes: cnt(p.likes) }));
}
export async function getPost(id) {
  const c = await client();
  const [{ data: post, error }, { data: comments }, { data: mine }] = await Promise.all([
    c.from("posts").select("id, board, title, body, photos, pinned, created_at, updated_at, user_id, profiles(nick), likes(count)").eq("id", id).maybeSingle(),
    c.from("comments").select("id, body, created_at, user_id, profiles(nick)").eq("post_id", id).order("created_at"),
    c.from("likes").select("post_id").eq("post_id", id).eq("user_id", user.id).maybeSingle(),
  ]);
  if (error) throw error;
  if (!post) return null;
  return { ...post, nick: post.profiles?.nick || "(알 수 없음)", nLikes: cnt(post.likes), liked: !!mine,
    comments: (comments || []).map((x) => ({ ...x, nick: x.profiles?.nick || "(알 수 없음)" })) };
}
export async function savePost({ id, board, title, body, photos }) {
  const c = await client();
  if (id) {
    const { error } = await c.from("posts").update({ board, title, body, photos }).eq("id", id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await c.from("posts").insert({ board, title, body, photos }).select("id").single();
  if (error) throw error;
  return data.id;
}
export async function deletePost(post) {
  const c = await client();
  const { error } = await c.from("posts").delete().eq("id", post.id);
  if (error) throw error;
  if (post.photos?.length) { try { await c.storage.from(BUCKET).remove(post.photos); } catch { /* 무시 */ } }
}
export async function setPinned(id, pinned) {
  const c = await client();
  const { error } = await c.from("posts").update({ pinned }).eq("id", id);
  if (error) throw error;
}
export async function toggleLike(id, on) {
  const c = await client();
  const { error } = on ? await c.from("likes").insert({ post_id: id }) : await c.from("likes").delete().eq("post_id", id).eq("user_id", user.id);
  if (error && error.code !== "23505") throw error;
}
export async function addComment(postId, body) {
  const c = await client();
  const { error } = await c.from("comments").insert({ post_id: postId, body });
  if (error) throw error;
}
export async function deleteComment(id) {
  const c = await client();
  const { error } = await c.from("comments").delete().eq("id", id);
  if (error) throw error;
}
