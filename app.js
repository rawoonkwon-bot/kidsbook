import { Scanner, warmUpDetector } from "./scanner.js";
import { lookupBook } from "./lookup.js";
import { toIsbn13 } from "./isbn.js";
import * as sync from "./sync.js";
import { ico, toIcon, ICON_EMOJI, PICK } from "./icons.js";
import { faceSvg, validFace, FACE_COLORS, FACE_COUNT } from "./faces.js";
import { makeRich, makeRichCE, richHtml, plainText, MARK } from "./rich.js";
import { TEXTBOOK } from "./textbook.js";

const $ = (id) => document.getElementById(id);

// ---------- 로그인 · 다른 집 구경 ----------
// 시작하기 전에 로그인을 확인하고 계정 기록과 맞춤 (그동안 첫 화면이 보임)
const AUTH = await sync.boot();
const PARAMS = new URLSearchParams(location.search);
const PEEK_ID = AUTH.user && !AUTH.offline ? PARAMS.get("peek") : null;
let PEEK = PEEK_ID ? await sync.fetchUser(PEEK_ID).catch(() => null) : null;
let PEEK_UID = PEEK_ID || null; // 구경 중인 집 (책 응원을 보낼 곳)
const mem = new Map();
// 엄마 별명(게시판 작성자 이름): null = 아직 없음, undefined = 인터넷 문제로 모름
let PROFILE;
if (AUTH.user && !AUTH.offline) { try { PROFILE = await sync.loadProfile(); } catch { PROFILE = undefined; } }
function fillMem(d, kid) {
  mem.clear();
  mem.set("kbc:kids:v1", JSON.stringify(d.kids || []));
  if (d.cats) mem.set("kbc:cats:v1", JSON.stringify(d.cats));
  mem.set("kbc:records:v1", JSON.stringify(d.records || []));
  mem.set("kbc:journal:v1", JSON.stringify(d.journal || []));
  if (kid) mem.set("kbc:activeKid", kid);
}
if (PEEK) fillMem(PEEK, PARAMS.get("kid"));
// 구경할 때는 휴대폰에 아무것도 저장하지 않음(메모리에만). 내 기록은 저장하면 계정에도 올라감
const memStore = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const localStore = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => { if (localStorage.getItem(k) === String(v)) return; localStorage.setItem(k, v); sync.touched(k); },
  removeItem: (k) => { if (localStorage.getItem(k) === null) return; localStorage.removeItem(k); sync.touched(k); },
};
let store = PEEK ? memStore : localStore;
const REC_KEY = "kbc:records:v1";
const BONUS = 50; // 독후활동 보너스 포인트
const STAMPS_PER_BOARD = 50;
const BOOK_CATS = ["문학", "자연과학", "사회과학", "역사", "예술", "언어", "기술과학", "철학", "종교", "총류", "기타"];
const SHELVES = { ko: "한글책", en: "영어책", focus: "집중듣기" };
const shelfName = (k) => SHELVES[k];
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}` : `${m}분`);

// ---------- 날짜 (한국 시간 기준 YYYY-MM-DD) ----------
const localDay = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localDay(d); };
const prettyDay = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  const w = "일월화수목금토"[new Date(y, m - 1, d).getDay()];
  const tag = day === daysAgo(0) ? " (오늘)" : day === daysAgo(1) ? " (어제)" : "";
  return `${m}월 ${d}일 ${w}요일${tag}`;
};
const shortDay = (day) => { const [, m, d] = day.split("-").map(Number); return `${m}월 ${d}일`; };
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// ---------- 저장소 ----------
// 한 권 = 기록 1개. 여러 날 읽은 내용은 sessions [{from, to, day}] 로 쌓임
// 같은 책을 여러 번 읽기: round = 지금 몇 번째 읽는지, 기록(session)마다 round, 다 읽은 회차는 finishes 에
const roundOf = (r) => r.round || 1;
const roundSessions = (r, n = roundOf(r)) => r.sessions.filter((s) => (s.round || 1) === n);
const readTo = (r) => Math.max(0, ...roundSessions(r).map((s) => s.to || 0));
const timesRead = (r) => (r.finishes || []).length;
const MAX_READS_PER_YEAR = 20;
const readsThisYear = (r) => (r.finishes || []).filter((f) => (f.day || "").startsWith(localDay().slice(0, 4))).length;
function migrate(r) {
  if (!r.sessions) {
    const day = r.date ? localDay(new Date(r.date)) : localDay();
    r.sessions = [{ from: r.pageFrom || null, to: r.pageTo || null, day }];
    delete r.pageFrom; delete r.pageTo;
  }
  if (r.done === undefined) {
    r.done = !!(r.totalPages && readTo(r) >= r.totalPages);
    if (r.done) r.doneAt = Date.parse(r.date) || Date.now();
  }
  if (!r.finishes) r.finishes = r.done ? [{ round: roundOf(r), day: r.doneDay || r.sessions.map((x) => x.day).sort().at(-1), at: r.doneAt || 0 }] : [];
  if (!r.bonusRounds) r.bonusRounds = r.bonus ? [1] : [];
  return r;
}
const uid = () => crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
const readJSON = (k, d) => { try { return JSON.parse(store.getItem(k)) ?? d; } catch { return d; } };

// ---------- 자녀 ----------
// 모든 기록은 자녀(kid)별로 저장. 화면에는 지금 고른 자녀의 기록만 보여 줌
const KIDS_KEY = "kbc:kids:v1", ACTIVE_KEY = "kbc:activeKid";
let kids = readJSON(KIDS_KEY, []);
let activeKid = store.getItem(ACTIVE_KEY);
if (!kids.some((k) => k.id === activeKid)) activeKid = kids[0]?.id || null;
const saveKids = () => {
  store.setItem(KIDS_KEY, JSON.stringify(kids));
  if (activeKid) store.setItem(ACTIVE_KEY, activeKid); else store.removeItem(ACTIVE_KEY);
};
const mineNow = (x) => !activeKid || !x.kid || x.kid === activeKid;

let allRecords = readJSON(REC_KEY, []).map(migrate);
let records = [];
const viewRecords = () => { records = allRecords.filter(mineNow); };
// 지금 보는 자녀의 기록(records)을 전체 기록에 반영해서 저장
const saveRecords = () => {
  for (const r of records) if (!r.kid && activeKid) r.kid = activeKid;
  const ids = new Set(records.map((r) => r.id));
  allRecords = [...records, ...allRecords.filter((r) => !ids.has(r.id) && !mineNow(r))];
  store.setItem(REC_KEY, JSON.stringify(allRecords));
};
viewRecords();
saveRecords();

// ---------- 계산 ----------
const sessionPages = (s) => (s.from && s.to ? Math.max(0, s.to - s.from + 1) : s.to || 0);
const pagesOf = (r) => r.sessions.reduce((a, s) => a + sessionPages(s), 0);
const minsOf = (r) => r.sessions.reduce((a, s) => a + (s.minutes || 0), 0);
// 집중듣기는 '들은' 기록: 쪽수·포인트·스탬프·권수에 넣지 않고 시간만 셈
const isFo = (r) => shelfOf(r) === "focus";
const readRecs = () => records.filter((r) => !isFo(r));
const pointsOf = (r) => isFo(r) ? 0 : pagesOf(r) + BONUS * (r.bonusRounds || (r.bonus ? [1] : [])).length;
const totalPoints = () => records.reduce((a, r) => a + pointsOf(r), 0);
const pct = (r) => (r.totalPages ? Math.min(100, Math.round((readTo(r) / r.totalPages) * 100)) : 0);
const sessionText = (s) => (s.from && s.to ? `${s.from}~${s.to}쪽` : s.to ? `~${s.to}쪽` : "쪽수 없음") + (s.minutes ? ` · ${fmtMin(s.minutes)}` : "");
const firstDay = (r) => r.sessions.map((s) => s.day).sort()[0];
const lastDay = (r) => r.sessions.map((s) => s.day).sort().at(-1);
function progressText(r) {
  const to = readTo(r);
  if (r.done) return `✅ 다 ${isFo(r) ? "들었어요" : "읽었어요"}!${r.totalPages ? ` (${r.totalPages}쪽)` : ""}${timesRead(r) > 1 ? ` · ${timesRead(r)}번 ${isFo(r) ? "들음" : "읽음"}` : ""}`;
  const v = isFo(r) ? "듣" : "읽";
  const nth = roundOf(r) > 1 ? `${roundOf(r)}번째 ${v}는 중 · ` : "";
  if (!to) return nth ? `${roundOf(r)}번째 ${v}기 시작` : "";
  return nth + (r.totalPages ? `진도율 ${pct(r)}% (${to} / ${r.totalPages}쪽)` : `${to}쪽까지 읽었어요`);
}
const hasHangul = (t) => /[가-힣]/.test(t || "");
const shelfOf = (r) => r.shelf || (hasHangul(r.title) ? "ko" : "en");
const stampList = (sh) => readRecs().filter((r) => !sh || shelfOf(r) === sh).flatMap((r) => (r.finishes || []).map((f) => ({ r, at: f.at || 0, round: f.round }))).sort((a, b) => a.at - b.at);

// ---------- UI 유틸 ----------
let toastTimer;
function toast(msg, ms = 2400) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}
function beep() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = 1320; g.gain.value = 0.08;
    o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.09);
    o.onended = () => ac.close();
  } catch { /* 무시 */ }
  navigator.vibrate?.(60);
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// 표지가 없거나 못 불러오면 제목 글자로 대신 보여 줌
const imgOr = (src, fallback, cls = "") => src
  ? `<img class="${cls}" src="${esc(src)}" alt="${esc(fallback)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:this.className,textContent:this.alt}))">`
  : `<div class="${cls}">${esc(fallback)}</div>`;
// 표지를 못 불러오면 깨진 그림 대신 빈 상자로
const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
const setImg = (el, src) => { el.onerror = () => { el.onerror = null; el.src = BLANK; }; el.src = src || BLANK; };

// 포인트 획득 효과
let burstTimer, burstDone;
function burst(n, then) {
  if (!n) { then?.(); return; }
  $("burstN").textContent = `+${n}`;
  $("burst").hidden = false;
  burstDone = () => { clearTimeout(burstTimer); $("burst").hidden = true; burstDone = null; then?.(); maybeReturn(); };
  burstTimer = setTimeout(() => burstDone?.(), 1500);
}
$("burst").addEventListener("click", () => burstDone?.());

// ---------- 탭 ----------
function go(tab) {
  document.querySelectorAll(".tab").forEach((s) => (s.hidden = s.dataset.tab !== tab));
  document.querySelectorAll(".tabbar button").forEach((b) => b.toggleAttribute("aria-current", b.dataset.go === tab));
  document.querySelectorAll(".tabbar button[aria-current]").forEach((b) => b.setAttribute("aria-current", "page"));
  $("kidBar").classList.toggle("off", tab !== "home" && tab !== "port"); // 자녀 고르기는 홈·포트폴리오에서만
  $("wsOpen").hidden = tab !== "home"; // 연산 프린트 동그라미는 홈에서만
  if (tab === "stats") { renderStats(); renderBrowse(); }
  if (tab === "port") renderCalendar();
  if (tab === "board") setTimeout(() => renderBoard()); // 게시판 코드가 아래에 있어서 한 박자 뒤에
  if (tab === "home") setTimeout(() => renderPopular());
  if (tab === "blog") setTimeout(() => renderMyBlog());
  window.scrollTo(0, 0);
  history.replaceState(null, "", location.pathname + location.search + (tab === "home" ? "" : `#${tab}`));
}
document.querySelectorAll(".tabbar button").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));

// ---------- 홈 ----------
const ringSvg = (frac) => {
  const r = 36, c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="${r}" fill="none" stroke="#E7E8EE" stroke-width="7"/>
    ${frac > 0 ? `<circle cx="42" cy="42" r="${r}" fill="none" stroke="#9DBE10" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c * Math.min(1, frac)).toFixed(1)} ${c.toFixed(1)}"/>` : ""}</svg>`;
};

// 읽은 횟수 막대: 1~4는 막대, 5번마다 네 막대 + 겨자색 사선 한 묶음 (최대 20)
function tallySvg(n) {
  n = Math.min(n, 20);
  const g = Math.floor(n / 5), rem = n % 5;
  let x = 3, body = "";
  for (let i = 0; i < g; i++) {
    for (let k = 0; k < 4; k++) body += `<path d="M${x + k * 3.2} 3.5v9" stroke="#2F5D3A"/>`;
    body += `<path d="M${x - 1.5} 11l12.6 -6" stroke="#C89B3C"/>`;
    x += 16;
  }
  for (let k = 0; k < rem; k++) body += `<path d="M${x + k * 3.2} 3.5v9" stroke="#2F5D3A"/>`;
  const w = Math.round((rem ? x + (rem - 1) * 3.2 : x - 6.4) + 3);
  return `<svg class="tally" viewBox="0 0 ${w} 16" width="${w}" height="16" fill="none" stroke-width="2" stroke-linecap="round" aria-hidden="true">${body}</svg>`;
}
const cardHtml = (r) => `
    <li data-id="${r.id}" tabindex="0" role="button" aria-label="${esc(r.title)} 기록 보기${timesRead(r) ? ` · ${timesRead(r)}번 읽음` : ""}" title="${esc(r.title)}">
      ${imgOr(r.cover, r.title, "cover")}
      ${r.done ? `<span class="done-badge" aria-label="완독">✓</span>` : r.totalPages ? `<div class="pbar"><i style="width:${pct(r)}%"></i></div>` : ""}
      ${timesRead(r) ? `<span class="tally-wrap">${tallySvg(timesRead(r))}</span>` : ""}
      ${r.home ? `<span class="home-badge" aria-label="우리 집 책장에 있는 책"><svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M6 1.2 1 5.6h1.6V11h2.9V7.6h1V11h2.9V5.6H11z" fill="currentColor"/></svg></span>` : ""}
    </li>`;

function render() {
  const month = localDay().slice(0, 7);
  const inMonth = (r, m) => r.sessions.some((s) => s.day.startsWith(m));
  // 숫자 링
  const monthN = readRecs().filter((r) => inMonth(r, month)).length;
  const onBoardOf = (sh) => { const n = stampList(sh).length; return n === 0 ? 0 : ((n - 1) % STAMPS_PER_BOARD) + 1; };
  const pts = totalPoints();
  $("ringMonth").innerHTML = ringSvg(0) + `<b>${monthN}<small>권</small></b>`;
  for (const [sh, id] of [["ko", "ringStampKo"], ["en", "ringStampEn"]]) { const o = onBoardOf(sh); $(id).innerHTML = ringSvg(o / STAMPS_PER_BOARD) + `<b>${o}<small>/${STAMPS_PER_BOARD}</small></b>`; }
  $("ringPoint").innerHTML = ringSvg(0) + `<b style="font-size:${pts >= 10000 ? 16 : 19}px">${pts.toLocaleString()}</b>`;

  renderTbCard();
  // 요즘 읽는 중
  const reading = records.filter((r) => !r.done && r.sessions.some((s) => s.to)).sort((a, b) => lastDay(b).localeCompare(lastDay(a)));
  $("readingHead").textContent = `📖 요즘 읽는 중 (${reading.length})`;
  $("reading").innerHTML = reading.map((r) => `
    <button type="button" class="read-card" data-id="${r.id}">
      ${r.cover ? `<div class="bgimg" style="background-image:url('${esc(r.cover)}')"></div>` : ""}
      <div>
        <b>${esc(r.title)}</b>
        <p>#${shelfName(shelfOf(r))}${r.category ? ` #${esc(r.category)}` : ""}</p>
        <p>${dayDiff(firstDay(r), localDay()) + 1}일 째 읽는 중</p>
        <p>${r.totalPages ? `진도율 : ${pct(r)}% (${readTo(r)} / ${r.totalPages})` : `${readTo(r)}쪽까지 읽었어요`}</p>
        ${r.totalPages ? `<div class="bar"><i style="width:${pct(r)}%"></i></div>` : ""}
      </div>
      ${imgOr(r.cover, r.title, "rc-cover")}
    </button>`).join("");

  // 책장
  const filter = $("monthFilter");
  const months = [...new Set(records.flatMap((r) => r.sessions.map((s) => s.day.slice(0, 7))))].sort().reverse();
  const cur = filter.value || "all";
  const homeN = records.filter((r) => r.home).length;
  filter.innerHTML = `<option value="all">전체 (${records.length})</option>` +
    (homeN || cur === "home" ? `<option value="home">우리 집 책장 (${homeN})</option>` : "") +
    months.map((m) => `<option value="${m}">${m.replace("-", "년 ")}월 (${records.filter((r) => inMonth(r, m)).length})</option>`).join("");
  filter.value = months.includes(cur) || cur === "home" ? cur : "all";
  const list = filter.value === "all" ? records : filter.value === "home" ? records.filter((r) => r.home) : records.filter((r) => inMonth(r, filter.value));
  for (const [key, suffix] of [["ko", "Ko"], ["en", "En"], ["focus", "Fo"]]) {
    const items = list.filter((r) => shelfOf(r) === key);
    $("shelf" + suffix).innerHTML = items.map(cardHtml).join("");
    $("count" + suffix).textContent = `${items.length}권`;
    $("empty" + suffix).hidden = items.length > 0;
  }

  if (!document.querySelector('.tab[data-tab="port"]').hidden) renderCalendar();
  if (!document.querySelector('.tab[data-tab="stats"]').hidden) renderStats();
  if ($("dayDialog").open && openDayKey) fillDay(openDayKey);
}
$("monthFilter").addEventListener("change", render);
for (const id of ["shelfKo", "shelfEn", "shelfFo", "reading"]) {
  const pick = (e) => e.target.closest("[data-id]")?.dataset.id;
  $(id).addEventListener("click", (e) => { const i = pick(e); if (i) openView(i); });
  $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { const i = pick(e); if (i) openView(i); } });
}
$("ringStampKoBtn").addEventListener("click", () => openStamp(null, "ko"));
$("ringStampEnBtn").addEventListener("click", () => openStamp(null, "en"));

// ---------- 1) 스캔 후 책 정보 시트 ----------
let sheet = null; // { isbn, book, existing, fo }
// 같은 책이라도 "읽은 기록"과 "집중듣기 기록"은 따로 둬요 (영어책은 듣고 나서 또 읽기도 하니까)
const recsOf = (isbn) => { const all = isbn ? records.filter((r) => r.isbn === isbn) : []; return { read: all.find((r) => !isFo(r)) || null, fo: all.find(isFo) || null }; };
const bookOfRec = (r) => (r ? { title: r.title, authors: r.authors ? [r.authors] : [], publisher: r.publisher, category: r.category, pages: r.totalPages, cover: r.cover, description: r.description } : null);
// 교과서 수록도서에서 열 때(info): 기록하기 없이 책 소개 + 읽은 친구들 별점만
function sheetMode(info) {
  $("sSnu").hidden = true;
  $("sSelf").hidden = $("sNote").hidden = $("sOk").hidden = $("sTiming").hidden = info;
  $("sRates").hidden = !info; if (info) $("sRates").innerHTML = `<small>읽은 친구들의 별점을 불러오는 중…</small>`;
}
async function paintRates(isbn, title) {
  let d = null;
  try { d = await sync.bookRatings(isbn, title); } catch { d = null; }
  if ($("sRates").hidden) return;
  if (!d) { $("sRates").innerHTML = `<small>별점은 로그인하고 인터넷에 연결돼 있을 때 볼 수 있어요</small>`; return; }
  const notes = (d.notes || []).map((x) => `<li><b>${esc(x.grade ? `${x.grade} 친구` : "친구")}</b>${x.score ? ` ${starsHtml(Number(x.score))}` : ""}<span>${esc(x.note)}</span></li>`).join("");
  $("sRates").innerHTML = `<h4>이 책을 읽은 친구들</h4>` + (d.n
    ? `<div class="sr-avg">${starsHtml(Number(d.avg))}<b>${Number(d.avg).toFixed(1)}</b><small>${d.n}명이 별점을 줬어요${d.readers > d.n ? ` · 읽은 친구 ${d.readers}명` : ""}</small></div>`
    : `<p class="sr-none">${d.readers ? `읽은 친구 ${d.readers}명 · 아직 별점이 없어요` : "아직 이 책을 읽은 친구가 없어요"}</p>`) +
    (notes ? `<ul class="sr-notes">${notes}</ul>` : "");
}
async function openSheet(isbn, scanInfo, opts = {}) {
  sheetMode(!!opts.info);
  if (opts.info) paintRates(isbn, opts.title);
  if (opts.snu != null) paintSnu(opts.snu);
  const { read: existing, fo: foRec } = recsOf(isbn);
  const ex0 = existing || foRec; // 화면에 보여 줄 내 기록
  sheet = { isbn, book: null, existing, fo: foRec };
  $("sCat").textContent = "책 정보";
  $("sTitle").textContent = "책 정보를 찾는 중…";
  $("sAuthor").textContent = ""; $("sPages").textContent = "";
  $("sDesc").textContent = ""; $("sDesc").classList.remove("open");
  $("sTiming").textContent = "";
  $("sMine").hidden = true;
  setImg($("sCover"), ex0?.cover);
  $("sOk").disabled = true; $("sOk").textContent = "확인";
  $("scanSheet").showModal();

  let { book, ms, cached } = await lookupBook(isbn, { needDescription: true });
  // 어디에도 없으면, 다른 회원이 직접 등록해 둔 책인지 확인
  if (!book && !PEEK) book = await sync.sharedBook(isbn).catch(() => null);
  // 쪽수만 없으면, 다른 회원이 적어 둔 쪽수로 채움
  else if (book && !book.pages && !PEEK) { const sb = await sync.sharedBook(isbn).catch(() => null); if (sb?.pages) book = { ...book, pages: sb.pages, pagesBy: "member" }; }
  if (!sheet || sheet.isbn !== isbn) return;
  sheet.book = book;
  const parts = [];
  if (scanInfo) parts.push(`인식 ${(scanInfo.ms / 1000).toFixed(2)}초`);
  parts.push(cached ? "저장된 정보" : `조회 ${(ms / 1000).toFixed(2)}초${book ? ` · ${book.source}` : ""}`);
  $("sTiming").textContent = parts.join(" · ");
  $("sOk").disabled = false;

  if (!book && !ex0 && opts.info) { // 교과서 목록: 목록의 제목·지은이로라도 보여 줌
    $("sTitle").textContent = opts.title; $("sAuthor").textContent = `〈작가〉 ${opts.author || "모름"}`;
    setImg($("sCover"), opts.cover); return;
  }
  if (!book && !ex0) {
    $("sTitle").textContent = "책 정보를 찾지 못했어요";
    $("sAuthor").textContent = "셀프등록에서 제목을 적으면 다른 판의 표지와 쪽수를 찾아 줘요. 한 번 등록하면 다음부터는 누구나 바로 찾아요.";
    $("sOk").textContent = "셀프등록";
    return;
  }
  const b = book || {};
  $("sCat").textContent = b.category || ex0?.category || (hasHangul(b.title || ex0?.title) ? "한글책" : "영어책");
  $("sTitle").textContent = ex0?.title || b.title;
  $("sAuthor").textContent = `〈작가〉 ${ex0?.authors || (b.authors || []).join(", ") || "모름"}`;
  const pages = ex0?.totalPages || b.pages;
  $("sPages").textContent = `〈페이지〉 ${pages ? `${pages} pages${!ex0?.totalPages && b.pagesBy ? " (회원이 적은 쪽수)" : ""}` : "정보 없음"}`;
  setImg($("sCover"), ex0?.cover || b.cover);
  $("sDesc").textContent = b.description || ex0?.description || "";
  if (existing) {
    $("sMine").hidden = false;
    const fo = isFo(existing); // 집중듣기 책은 "듣기"로
    $("sMine").textContent = existing.done ? `${fo ? "🎧" : "📚"} ${timesRead(existing)}번 다 ${fo ? "들은" : "읽은"} 책이에요 · 기록 보기 ›` : `${fo ? "🎧 듣고" : "📚 읽고"} 있는 책이에요 · ${progressText(existing) || "쪽수 기록 없음"}`;
    $("sMine").classList.toggle("link", !!existing.done);
    $("sOk").textContent = existing.done ? `🔁 다시 ${fo ? "듣기" : "읽기"} (${roundOf(existing) + 1}번째)` : "이어서 기록하기";
  } else if (foRec) { // 집중듣기만 한 책: 들은 기록은 따로 두고, 읽은 책으로 새로 기록
    $("sMine").hidden = false;
    $("sMine").textContent = foRec.done ? `🎧 ${timesRead(foRec)}번 다 들은 책이에요 · 들은 기록 보기 ›` : `🎧 듣고 있는 책이에요 · 들은 기록 보기 ›`;
    $("sMine").classList.add("link");
    $("sOk").textContent = "📖 읽은 책으로 기록하기";
  }
}
$("sDesc").addEventListener("click", () => $("sDesc").classList.toggle("open"));
$("sSelf").addEventListener("click", () => $("scanSheet").close("self"));
$("sMine").addEventListener("click", () => { if ($("sMine").classList.contains("link")) $("scanSheet").close("view"); });
// 다 읽은 책 다시 읽기 (같은 해에 20번까지)
function startReread(r, pick = false) {
  if (readsThisYear(r) >= MAX_READS_PER_YEAR) {
    toast(`같은 책은 한 해에 ${MAX_READS_PER_YEAR}번까지 기록할 수 있어요. 내년에 다시 기록해 주세요`, 3800);
    return false;
  }
  openRecord({ existing: r, reread: true, pick });
  return true;
}
$("scanSheet").addEventListener("close", () => {
  const v = $("scanSheet").returnValue;
  const s = sheet; sheet = null;
  if (!s || (v !== "ok" && v !== "self" && v !== "view")) return; // ✕ = 검색만 하고 끝
  if (v === "view" && (s.existing || s.fo)) { openView((s.existing || s.fo).id); return; }
  if (s.existing) { s.existing.done && v === "ok" ? startReread(s.existing, true) : openRecord({ existing: s.existing, pick: true }); return; }
  const bk = s.book || bookOfRec(s.fo); // 들은 기록이 있으면 그 책 정보로 읽은 기록을 새로 시작
  openRecord({ isbn: s.isbn, book: bk, self: v === "self" || !bk, pick: true, notFocus: !!s.fo });
});

// ---------- 2) 책 기록 화면 ----------
let rec = null; // { existing, isbn, book, self }
let rDay = localDay();
let chosenShelf = "ko";
const paintShelf = () => {
  [...$("shelfPick").children].forEach((x) => x.setAttribute("aria-checked", String(x.dataset.shelf === chosenShelf)));
  $("focusRow").hidden = chosenShelf !== "focus"; // 책 기록에서 시간은 집중듣기만 (한글책·영어책 읽은 시간은 포트폴리오에서)
  if ($("rState")) paintState();
  $("rDone").nextElementSibling.textContent = chosenShelf === "focus" ? "다 들음" : "완독";
};
let preferShelf = null; // 포트폴리오 날짜 시트에서 스캔하면 그 책장을 먼저 골라 둠
$("shelfPick").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { chosenShelf = b.dataset.shelf; paintShelf(); } });

function paintDate() {
  const t = localDay(), y = daysAgo(1);
  const which = rDay === t ? "today" : rDay === y ? "yesterday" : "pick";
  [...$("dateChips").querySelectorAll("button")].forEach((b) => b.classList.toggle("on", b.dataset.d === which));
  const [, m, d] = rDay.split("-").map(Number);
  $("datePickBtn").textContent = which === "pick" ? `📅 ${m}월 ${d}일` : "📅 날짜 고르기";
  $("dateSay").textContent = `${prettyDay(rDay)}에 읽었어요`;
  $("rDate").max = t; $("rDate").value = rDay;
}
$("dateChips").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-d]"); if (!b || b.dataset.d === "pick") return;
  rDay = b.dataset.d === "today" ? localDay() : daysAgo(1); paintDate();
});
$("rDate").addEventListener("click", () => { try { $("rDate").showPicker(); } catch { /* 지원 안 하는 브라우저는 기본 동작 */ } });
$("rDate").addEventListener("change", () => {
  const v = $("rDate").value;
  if (v > localDay()) toast("오늘 이후 날짜는 고를 수 없어요");
  if (v) rDay = v > localDay() ? localDay() : v;
  paintDate();
});

function syncDone() {
  const on = $("rDone").checked;
  $("rTo").disabled = on;
  if (on) $("rTo").value = $("rTotal").value;
}
$("rDone").addEventListener("change", syncDone);
$("rTotal").addEventListener("input", () => { if ($("rDone").checked) $("rTo").value = $("rTotal").value; });
// 책 상태 카드: 다 읽은 책 / 읽고 있는 책 (둘 중 하나) + 우리 집 책장 (따로 켜고 끄기)
function paintState() {
  const fo = chosenShelf === "focus";
  $("stDoneB").textContent = fo ? "다 들은 책" : "다 읽은 책"; $("stDoneS").textContent = fo ? "끝까지 들었어요" : "끝까지 읽었어요";
  $("stReadB").textContent = fo ? "듣고 있는 책" : "읽고 있는 책"; $("stReadS").textContent = fo ? "지금 듣는 중" : "지금 읽는 중";
  const on = { done: $("rDone").checked, reading: !$("rDone").checked, home: $("rHome").checked };
  [...$("rState").children].forEach((b) => b.setAttribute("aria-pressed", String(!!on[b.dataset.s])));
}
$("rState").addEventListener("click", (e) => {
  const b = e.target.closest("[data-s]"); if (!b) return;
  const s = b.dataset.s;
  if (s === "home") $("rHome").checked = !$("rHome").checked;
  else { $("rDone").checked = s === "done"; $("rDone").dispatchEvent(new Event("change")); }
  paintState();
});

function openRecord({ existing = null, isbn = null, book = null, self = false, reread = false, pick = false, notFocus = false }) {
  rec = { existing, isbn: existing?.isbn || isbn, book, self, reread, pick };
  // 스캔해서 들어왔을 때: 누구 기록인지 고르기 (아이가 둘 이상일 때)
  $("rKidWrap").hidden = !(pick && kids.length > 1 && !PEEK);
  $("rKids").innerHTML = kids.map((k) => `<button type="button" role="radio" data-kid="${k.id}" aria-checked="${k.id === activeKid}">${esc(k.nick)}${gradeOf(k) ? ` <small>${gradeOf(k)}</small>` : ""}</button>`).join("");
  const b = book || {};
  const title = existing?.title || b.title || "";
  const authors = existing?.authors || (b.authors || []).join(", ");
  const publisher = existing?.publisher || b.publisher || "";
  const category = existing?.category || b.category || "";
  const total = existing?.totalPages || b.pages || null;
  const desc = existing?.description || b.description || "";

  setImg($("rCover"), existing?.cover || b.cover);
  $("rTitleText").innerHTML = esc(title) + tbHtml(tbGrades(rec.isbn, title, authors));
  $("rTitleText").hidden = self;
  $("rTitle").hidden = !self; $("rAuthor").hidden = !self;
  $("rTitle").value = title; $("rAuthor").value = authors;
  $("rFind").hidden = !self; $("rFindList").hidden = true; $("rFindList").innerHTML = "";
  $("rMeta").textContent = [publisher && `(출판사) ${publisher}`, !self && authors && `(작가) ${authors}`, category && `(분야) ${category}`, total && `${total} pages`]
    .filter(Boolean).join("\n") || (rec.isbn ? `ISBN ${rec.isbn}` : "");
  $("rDesc").textContent = desc; $("rDesc").classList.remove("open");
  $("rDescHead").hidden = !desc;

  chosenShelf = existing ? shelfOf(existing) : (notFocus && preferShelf === "focus" ? null : preferShelf) || (title ? (hasHangul(title) ? "ko" : "en") : (rec.isbn?.startsWith("97911") || rec.isbn?.startsWith("97889") ? "ko" : "en"));
  paintShelf();
  rDay = returnDay || localDay(); paintDate();

  const prev = existing && !reread ? readTo(existing) : 0;
  $("soFar").hidden = !prev && !reread;
  $("soFar").textContent = reread ? `🔁 ${roundOf(existing) + 1}번째 ${isFo(existing) ? "듣기" : "읽기"}를 시작해요! 1쪽부터 다시 기록해요`
    : prev ? `지난번까지 ${prev}쪽 읽었어요 → 오늘은 ${prev + 1}쪽부터` : "";
  $("rTotal").value = total || "";
  $("rFrom").value = prev + 1; // 다음 기록은 지난번 다음 쪽부터 (고칠 수 있어요)
  $("rTo").value = ""; $("rMin").value = ""; $("rHour").value = "";
  $("rTo").placeholder = "몇 쪽까지";
  // 쪽수 정보가 없는 책: 적어 주면 다른 회원과 함께 써요
  rec.noPages = !total && !!rec.isbn && !self;
  $("pagesShare").hidden = !rec.noPages;
  $("rDone").checked = false; // 완독은 직접 고를 때만 (기본: 읽고 있는 책)
  $("rHome").checked = !!existing?.home;
  rStars.set(existing?.score || 0);
  paintState();
  $("pagesLabel").textContent = prev ? "오늘 읽은 쪽 (몇 쪽부터 ~ 몇 쪽까지) / 전체" : "읽은 쪽 (몇 쪽부터 ~ 몇 쪽까지) / 전체";
  syncDone();
  $("rTiming").textContent = rec.isbn ? `ISBN ${rec.isbn}` : "";
  $("recordPage").showModal();
  $("recordPage").scrollTop = 0;
  if (self) setTimeout(() => $("rTitle").focus(), 50);
}
$("rDesc").addEventListener("click", () => $("rDesc").classList.toggle("open"));
// 셀프등록: 제목으로 비슷한 책을 찾아 표지·쪽수 채우기
let findResults = [];
$("rFind").addEventListener("click", async () => {
  const q = $("rTitle").value.trim();
  if (q.length < 2) { toast("책 제목을 먼저 적어 주세요"); $("rTitle").focus(); return; }
  $("rFindList").hidden = false;
  $("rFindList").innerHTML = `<small>찾는 중…</small>`;
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    findResults = r.ok ? (await r.json()).results || [] : [];
    $("rFindList").innerHTML = findResults.length
      ? `<small>같은 책을 고르면 표지와 쪽수를 채워요</small>` + findResults.map((b, i) => `<button type="button" class="find-item" data-i="${i}">
          ${b.cover ? `<img src="${esc(b.cover)}" alt="">` : `<span class="noimg"></span>`}
          <span><b>${esc(b.title)}</b><small>${esc((b.authors || []).join(", "))}${b.pages ? ` · ${b.pages}쪽` : ""}</small></span></button>`).join("")
      : `<small>비슷한 책을 찾지 못했어요. 제목과 쪽수를 직접 적어 주세요.</small>`;
  } catch { $("rFindList").innerHTML = `<small>찾지 못했어요. 인터넷 연결을 확인해 주세요.</small>`; }
});
$("rFindList").addEventListener("click", (e) => {
  const t = e.target.closest("[data-i]"); if (!t || !rec) return;
  const b = findResults[Number(t.dataset.i)];
  rec.book = { ...(rec.book || {}), cover: b.cover || rec.book?.cover || "", publisher: b.publisher || "", authors: b.authors || [] };
  if (!$("rAuthor").value.trim()) $("rAuthor").value = (b.authors || []).join(", ");
  if (b.pages) $("rTotal").value = b.pages;
  setImg($("rCover"), b.cover);
  $("rFindList").hidden = true;
  syncDone();
  toast(b.pages ? `표지와 쪽수(${b.pages}쪽)를 채웠어요` : "표지를 채웠어요");
});

function saveRecord() {
  if (!rec) return;
  const r0 = rec.existing;
  const prev = r0 && !rec.reread ? readTo(r0) : 0;
  const total = parseInt($("rTotal").value, 10) || null;
  const done = $("rDone").checked;
  if (rec.reread && readsThisYear(r0) >= MAX_READS_PER_YEAR) { toast(`같은 책은 한 해에 ${MAX_READS_PER_YEAR}번까지 기록할 수 있어요`); return; }
  const to = done ? total : parseInt($("rTo").value, 10) || null;
  const from = parseInt($("rFrom").value, 10) || prev + 1;
  const title = rec.self ? $("rTitle").value.trim() : (r0?.title || rec.book?.title || "");
  if (!title) { toast("책 제목을 적어 주세요"); $("rTitle").focus(); return; }
  if (done && !total) { toast("전체 쪽수를 적어 주세요"); $("rTotal").focus(); return; }
  if (!to) { toast("몇 쪽까지 읽었는지 적어 주세요"); $("rTo").focus(); return; }
  if (total && to > total) { toast(`전체 쪽수(${total}쪽)보다 클 수 없어요`); return; }
  if (to <= prev) { toast(`지난번(${prev}쪽)보다 뒤의 쪽을 적어 주세요`); return; }
  if (from < 1 || from > to) { toast(`시작 쪽(${from}쪽)이 끝 쪽(${to}쪽)보다 클 수 없어요`); $("rFrom").focus(); return; }

  const minutes = chosenShelf === "focus" ? ((parseInt($("rHour").value, 10) || 0) * 60 + (parseInt($("rMin").value, 10) || 0)) || null : null;
  if (chosenShelf === "focus" && !minutes) { toast("집중듣기 시간을 적어 주세요"); $("rMin").focus(); return; }
  if (rDay > localDay()) { rDay = localDay(); paintDate(); toast("오늘 이후 날짜는 고를 수 없어요"); return; }

  // 같은 책은 읽은 기록 하나 · 들은 기록 하나만 (같은 종류가 이미 있으면 그 기록에 이어서)
  const twin = rec.isbn ? records.find((x) => x.isbn === rec.isbn && x !== r0 && isFo(x) === (chosenShelf === "focus")) : null;
  if (twin) { toast(`이미 ${chosenShelf === "focus" ? "집중듣기로" : "읽은 책으로"} 기록한 책이에요. 그 기록에서 이어서 적어 주세요`, 3500); return; }
  const session = { from, to, day: rDay, ...(minutes ? { minutes } : {}) };
  if (rec.noPages && total && !PEEK) sync.sharePages({ isbn: rec.isbn, title, authors: r0?.authors || (rec.book?.authors || []).join(", "), publisher: r0?.publisher || rec.book?.publisher, cover: r0?.cover || rec.book?.cover, pages: total }).catch(() => {});
  let r;
  if (r0) {
    r = r0;
    if (rec.reread) { r.round = roundOf(r) + 1; r.done = false; delete r.doneAt; delete r.doneDay; }
    if (roundOf(r) > 1) session.round = roundOf(r);
    r.sessions.push(session);
    r.shelf = chosenShelf;
    if (total) r.totalPages = total;
    if ($("rHome").checked) r.home = true; else delete r.home;
    if (rStars.get()) r.score = rStars.get(); else delete r.score;
    records = [r, ...records.filter((x) => x.id !== r.id)]; // 최근 읽은 책이 앞으로
  } else {
    const b = rec.book || {};
    r = {
      id: crypto.randomUUID?.() || String(Date.now()),
      isbn: rec.isbn || "",
      title,
      authors: rec.self ? $("rAuthor").value.trim() : (b.authors || []).join(", "),
      publisher: b.publisher || "",
      cover: b.cover || "",
      description: (b.description || "").slice(0, 2000),
      category: b.category || "",
      shelf: chosenShelf,
      totalPages: total,
      sessions: [session],
      ...($("rHome").checked ? { home: true } : {}),
      done: false, score: rStars.get() || null, note: "", bonus: false, finishes: [], bonusRounds: [],
      date: new Date().toISOString(),
    };
    records.unshift(r);
    // 바코드로 못 찾은 책은 함께 쓰는 책 목록에 올려 두기 → 다음부터 누구나 바로 찾음
    if (rec.self && rec.isbn && !PEEK) sync.shareBook({ isbn: rec.isbn, title, authors: r.authors, publisher: r.publisher, cover: r.cover, pages: total }).catch(() => {});
  }
  const gained = to - prev;
  const finished = !!(r.totalPages && to >= r.totalPages);
  if (finished && !r.done) {
    r.done = true; r.doneAt = Date.now(); r.doneDay = rDay;
    r.finishes = [...(r.finishes || []).filter((f) => f.round !== roundOf(r)), { round: roundOf(r), day: rDay, at: r.doneAt }];
  }
  saveRecords();
  $("monthFilter").value = "all";
  render();
  rec = null;
  if (isFo(r)) { // 집중듣기: 포인트·스탬프·독후활동 없이 기록만
    flow = null;
    $("recordPage").close("saved");
    toast(finished ? `👂 끝까지 들었어요! (${fmtMin(minutes)})` : `👂 ${to}쪽까지 들었어요 · ${fmtMin(minutes)}`);
    return;
  }
  flow = { r, pages: gained };
  $("recordPage").close("saved");
  if (finished) $("finishSheet").showModal();
  else burst(gained, () => toast(`📖 ${to}쪽까지 읽었어요!${minutes ? ` · ${fmtMin(minutes)}` : ""}`));
}
$("rSave").type = "button";
$("rSave").addEventListener("click", saveRecord);
["rFrom", "rTo", "rTotal", "rHour", "rMin"].forEach((id) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveRecord(); } }));
$("recordPage").addEventListener("close", () => { rec = null; });

// ---------- 3) 다 읽었을 때 마무리 ----------
let flow = null; // { r, pages }
$("finishSheet").addEventListener("close", () => {
  const f = flow; if (!f) return;
  if ($("finishSheet").returnValue === "activity") openActivity(f.r, { pages: f.pages, fromFlow: true });
  else { flow = null; burst(f.pages, () => openStamp(f.r.id)); } // '스탬프 바로 받기' (창을 그냥 닫아도 스탬프는 받음)
});

// ---------- 4) 독후 활동 ----------
let act = null; // { r, pages, fromFlow }
let stars = 0;
const STAR = `<svg viewBox="0 0 24 24"><path d="M12 2.2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.4l7.1-.6z"/></svg>`;
// 별점 (반쪽 가능): 별의 왼쪽 절반을 누르면 0.5, 오른쪽을 누르면 1개. 같은 점수를 다시 누르면 지워요
function starWidget(el, onChange) {
  let v = 0;
  el.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-label="${n}점" data-n="${n}"><span class="sb">${STAR}</span><span class="sf">${STAR}</span></button>`).join("");
  const paint = () => [...el.children].forEach((b) => {
    const n = Number(b.dataset.n), f = Math.max(0, Math.min(1, v - (n - 1)));
    b.querySelector(".sf").style.width = `${f * 100}%`;
    b.setAttribute("aria-checked", String(Math.ceil(v) === n));
  });
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const rc = b.getBoundingClientRect(), n = Number(b.dataset.n);
    const nv = e.clientX && e.clientX < rc.left + rc.width / 2 ? n - 0.5 : n;
    v = v === nv ? 0 : nv; paint(); onChange?.(v);
  });
  return { get: () => v, set: (x) => { v = Number(x) || 0; paint(); } };
}
const starsHtml = (v) => `<span class="stars mini">${[1, 2, 3, 4, 5].map((n) => `<span><span class="sb">${STAR}</span><span class="sf" style="width:${Math.max(0, Math.min(1, v - (n - 1))) * 100}%">${STAR}</span></span>`).join("")}</span>`;
const aStars = starWidget($("stars"), (x) => { stars = x; });
const paintStars = () => aStars.set(stars);
const rStars = starWidget($("rStars"));
$("aText").addEventListener("input", () => ($("aCount").textContent = $("aText").value.length));

function openActivity(r, ctx) {
  act = { r, ...ctx };
  setImg($("aCover"), r.cover);
  $("aTitle").textContent = r.title;
  stars = r.score || 0; paintStars();
  $("aText").value = r.note || ""; $("aCount").textContent = $("aText").value.length;
  $("activityPage").showModal();
  $("activityPage").scrollTop = 0;
}
function finishActivity(kind) {
  const a = act; if (!a) return;
  const text = $("aText").value.trim();
  if (kind === "done" && !text) { toast("생각을 한 줄이라도 적어 주세요 (안 적으려면 건너뛰기)"); $("aText").focus(); return; }
  const r = a.r;
  if (stars) r.score = stars;
  let extra = 0;
  if (kind === "done") {
    r.note = text;
    r.bonusRounds = r.bonusRounds || [];
    if (!r.bonusRounds.includes(roundOf(r))) { r.bonusRounds.push(roundOf(r)); r.bonus = true; extra = BONUS; }
  }
  saveRecords(); render();
  act = null; flow = null;
  $("activityPage").close("finished");
  if (a.fromFlow) burst(a.pages + extra, () => openStamp(r.id));
  else if (extra) burst(extra, () => toast("✏️ 독후활동을 저장했어요"));
  else toast(stars ? `★ ${stars}점을 저장했어요` : "저장했어요");
}
$("aSkip").type = "button";
$("aSkip").addEventListener("click", () => finishActivity("skip"));
const aDone = $("activityPage").querySelector('button[value="done"]');
aDone.type = "button";
aDone.addEventListener("click", () => finishActivity("done"));
// Esc 등으로 그냥 닫혀도 건너뛰기처럼 처리 (흐름 중이면 스탬프는 받음)
$("activityPage").addEventListener("cancel", (e) => { e.preventDefault(); finishActivity("skip"); });

// ---------- 5) 독서 스탬프 (한 판 50개, 다 모으면 졸업장) ----------
const dayOfStamp = (x) => (x.r.finishes || []).find((f) => f.round === x.round)?.day || localDay(new Date(x.at || Date.now()));
let stampOn = [], stampSh = "ko";
const shWord = (sh) => sh === "en" ? "영어책" : "한글책";
const rewardKey = (sh) => sh === "en" ? "rewardEn" : "reward";
function openStamp(newId, sh) {
  if (newId) { const r = records.find((x) => x.id === newId); if (r) sh = shelfOf(r); }
  stampSh = sh === "en" ? "en" : "ko";
  for (const b of $("stampTabs").querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.sh === stampSh));
  const list = stampList(stampSh);
  const n = list.length;
  const board = n === 0 ? 0 : Math.floor((n - 1) / STAMPS_PER_BOARD);
  const on = (stampOn = list.slice(board * STAMPS_PER_BOARD, board * STAMPS_PER_BOARD + STAMPS_PER_BOARD));
  $("stampCount").textContent = `${on.length} / ${STAMPS_PER_BOARD}`;
  $("stampBar").style.width = `${(on.length / STAMPS_PER_BOARD) * 100}%`;
  $("stampGrid").innerHTML = Array.from({ length: STAMPS_PER_BOARD }, (_, i) => {
    const x = on[i], gold = (i + 1) % 10 === 0 ? " gold" : "";
    if (!x) return `<div class="stamp${gold}" aria-label="빈 칸"></div>`;
    const r = x.r, isNew = r.id === newId && x.round === (r.finishes || []).at(-1)?.round;
    return `<button type="button" class="stamp on${gold}${isNew ? " new" : ""}" data-i="${i}" title="${esc(r.title)}${x.round > 1 ? ` (${x.round}번째)` : ""}">${r.cover ? `<img src="${esc(r.cover)}" alt="">` : `<span>${esc([...r.title][0] || "")}</span>`}</button>`;
  }).join("");
  const full = on.length === STAMPS_PER_BOARD;
  $("stampDone").hidden = !full;
  $("stampDone").innerHTML = full ? `<b>🎉 ${shWord(stampSh)} ${STAMPS_PER_BOARD}권 완주!</b><button type="button" class="btn dark" data-cert="${board}">졸업장 보기</button>` : "";
  paintReward();
  const boards = Math.floor(n / STAMPS_PER_BOARD);
  $("certList").innerHTML = boards ? `<b>받은 졸업장</b>` + Array.from({ length: boards }, (_, b) => `<button type="button" data-cert="${b}">${b + 1}번째 졸업장 · ${prettyDay(dayOfStamp(list[(b + 1) * STAMPS_PER_BOARD - 1]))}</button>`).join("") : "";
  if (!$("stampPage").open) $("stampPage").showModal();
  // 방금 받은 스탬프로 한 판을 다 채웠으면 졸업장을 바로 보여 줘요
  if (full && newId && on.some((x) => x.r.id === newId)) setTimeout(() => openCert(board), 1200);
}
const kidNow = () => kids.find((k) => k.id === activeKid) || null;
function paintReward() {
  const k = kidNow(), rw = k?.[rewardKey(stampSh)] || "";
  $("rewardEdit").hidden = true;
  $("reward").innerHTML = rw
    ? `<span class="gift">🎁</span><span><small>${STAMPS_PER_BOARD}개 모으면</small><b>${esc(rw)}</b></span>${PEEK ? "" : `<button type="button" class="link-btn" data-rw>바꾸기</button>`}`
    : PEEK ? "" : `<button type="button" class="reward-add" data-rw>🎁 ${STAMPS_PER_BOARD}개 모으면 받을 선물을 정해 주세요 ›</button>`;
  $("reward").hidden = !$("reward").innerHTML;
}
$("reward").addEventListener("click", (e) => {
  if (!e.target.closest("[data-rw]")) return;
  $("rewardIn").value = kidNow()?.[rewardKey(stampSh)] || "";
  $("reward").hidden = true; $("rewardEdit").hidden = false; $("rewardIn").focus();
});
$("rewardSave").addEventListener("click", () => {
  const k = kidNow(); if (!k || PEEK) return;
  const v = $("rewardIn").value.trim();
  if (v) k[rewardKey(stampSh)] = v; else delete k[rewardKey(stampSh)];
  saveKids(); paintReward();
  toast(v ? "선물을 정했어요" : "선물을 지웠어요");
});
$("rewardIn").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("rewardSave").click(); } });
$("stampGrid").addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b && stampOn[b.dataset.i]) openView(stampOn[b.dataset.i].r.id); });
$("stampPage").addEventListener("click", (e) => { const b = e.target.closest("[data-cert]"); if (b) openCert(Number(b.dataset.cert)); });
$("stampTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-sh]"); if (b && b.dataset.sh !== stampSh) openStamp(null, b.dataset.sh); });

// 독서 졸업장
function openCert(board) {
  const list = stampList(stampSh).slice(board * STAMPS_PER_BOARD, (board + 1) * STAMPS_PER_BOARD);
  if (list.length < STAMPS_PER_BOARD) return;
  const k = kidNow(), d = (x) => { const [y, m, dd] = dayOfStamp(x).split("-"); return `${y}년 ${Number(m)}월 ${Number(dd)}일`; };
  $("cert").innerHTML = `
    <img class="cert-logo" src="/logo.svg" alt="">
    <p class="cert-kicker">바나나북코드</p>
    <h2>독서 졸업장</h2>
    <p class="cert-no">${shWord(stampSh)} ${board + 1}번째 스탬프판</p>
    <p class="cert-name"><b>${esc(k?.nick || "")}</b>${k && gradeOf(k) ? ` <small>${gradeOf(k)}</small>` : ""}</p>
    <p class="cert-body">위 어린이는 ${d(list[0])}부터 ${d(list.at(-1))}까지<br>${shWord(stampSh)} <b>${STAMPS_PER_BOARD}권</b>을 끝까지 읽었기에<br>이 졸업장을 드립니다.</p>
    ${k?.[rewardKey(stampSh)] ? `<p class="cert-reward">🎁 약속한 선물: <b>${esc(k[rewardKey(stampSh)])}</b></p>` : ""}
    <ol class="cert-books">${list.map((x) => `<li>${esc(x.r.title)}${x.round > 1 ? ` <small>(${x.round}번째)</small>` : ""}</li>`).join("")}</ol>
    <p class="cert-date">${d(list.at(-1))}</p>`;
  $("certPage").showModal();
  $("certPage").scrollTop = 0;
}
$("certClose").addEventListener("click", () => $("certPage").close());
// 아이폰은 인쇄 창이 뜨기 전에 다음 줄로 넘어가요. 그래서 인쇄용 표시는 창을 닫을 때 지워요 (화면에는 영향 없음)
$("certPrint").addEventListener("click", () => {
  document.body.classList.add("printing");
  window.print(); // 누른 순간 바로 불러야 아이폰이 "자동 프린트 차단"을 띄우지 않아요
});
$("certPage").addEventListener("close", () => document.body.classList.remove("printing"));

// ---------- 책장에서 책 눌렀을 때 ----------
let viewing = null;
// 책 기록 보기에서 적은 읽은 시간 (포트폴리오 기록에 이 책 표시가 붙어 있음)
const bookTimes = (r) => journal.filter((j) => j.book === r.id && j.minutes).sort((a, b) => a.day.localeCompare(b.day));
const bookMins = (r) => bookTimes(r).reduce((a, j) => a + j.minutes, 0);
let entryBook = null; // 책 기록 보기에서 시간 적기를 눌렀을 때 그 책 id
$("vCat").innerHTML = `<option value="">미분류</option>` + BOOK_CATS.map((c) => `<option>${c}</option>`).join("");
function openView(id) {
  const r = records.find((x) => x.id === id); if (!r) return;
  viewing = r;
  fillView(r);
  $("viewDialog").showModal();
}
function fillView(r) {
  setImg($("vCover"), r.cover);
  $("vTitle").innerHTML = esc(r.title) + tbHtml(tbGrades(r.isbn, r.title, r.authors));
  $("vAuthor").textContent = r.authors || "";
  $("vMeta").textContent = [SHELVES[shelfOf(r)], r.totalPages && `${r.totalPages}쪽`, (minsOf(r) + bookMins(r)) && `${fmtMin(minsOf(r) + bookMins(r))} ${isFo(r) ? "들음" : "읽음"}`, !isFo(r) && `${pointsOf(r)}점`].filter(Boolean).join(" · ");
  $("vProgress").innerHTML = progressText(r)
    ? `<b>${esc(progressText(r))}</b>${r.totalPages ? `<div class="bar"><i style="width:${pct(r)}%"></i></div>` : ""}` : "";
  const rounds = roundOf(r);
  $("vSessions").innerHTML = Array.from({ length: rounds }, (_, i) => i + 1).map((n) => {
    const ss = roundSessions(r, n).sort((a, b) => a.day.localeCompare(b.day));
    const fin = (r.finishes || []).find((f) => f.round === n);
    const head = rounds > 1 || fin ? `<li class="round-h"><b>${n}번째</b><span>${ss[0] ? shortDay(ss[0].day) : ""}${fin ? ` ~ ${shortDay(fin.day)} · 다 ${isFo(r) ? "들음" : "읽음"}` : ` ~ ${isFo(r) ? "듣는" : "읽는"} 중`}</span></li>` : "";
    return head + ss.map((s) => `<li><span>${prettyDay(s.day)}</span><b>${sessionText(s)}</b></li>`).join("");
  }).join("");
  const bt = bookTimes(r); // 따로 적은 읽은 시간
  if (bt.length) $("vSessions").innerHTML += `<li class="round-h"><b>⏱ 읽은 시간</b><span>모두 ${fmtMin(bookMins(r))}</span></li>` + bt.map((x) => `<li><span>${prettyDay(x.day)}</span><b>${fmtMin(x.minutes)}</b></li>`).join("");
  $("vHome").checked = !!r.home; $("vHome").disabled = !!PEEK;
  $("vTimes").innerHTML = timesRead(r) ? `${tallySvg(timesRead(r))}<span>${timesRead(r)}번 ${isFo(r) ? "들었어요" : "읽었어요"}</span>` : "";
  $("vMore").hidden = false;
  $("vTime").hidden = isFo(r) || !!PEEK; // 한글책·영어책: 읽은 시간은 포트폴리오 기록으로 남김
  $("vMore").textContent = r.done ? `🔁 다시 ${isFo(r) ? "듣기" : "읽기"} (${rounds + 1}번째)` : "➕ 이어서 기록하기";
  $("vSessH").textContent = isFo(r) ? "🎧 들은 기록" : "📖 읽은 기록";
  $("vActivity").hidden = isFo(r) || !(r.done && !(r.bonusRounds || []).includes(rounds));
  $("vScore").innerHTML = r.score ? `${starsHtml(r.score)} ${r.score}점` : "주지 않았어요";
  $("vNote").textContent = r.note || "적지 않았어요";
  paintCheer(r);
  $("vCat").value = BOOK_CATS.includes(r.category) ? r.category : "";
  $("vTotalRow").hidden = !!r.totalPages;
  $("vTotal").value = "";
}
$("vHome").addEventListener("change", () => {
  if (!viewing || PEEK) return;
  if ($("vHome").checked) viewing.home = true; else delete viewing.home;
  saveRecords(); render();
  toast($("vHome").checked ? "우리 집 책장에 넣었어요" : "우리 집 책장에서 뺐어요");
});
$("vCat").addEventListener("change", () => { if (!viewing) return; viewing.category = $("vCat").value; saveRecords(); render(); toast("분야를 바꿨어요"); });
$("vTotalSave").addEventListener("click", () => {
  const t = parseInt($("vTotal").value, 10);
  if (!viewing || !t) return;
  viewing.totalPages = t;
  if (readTo(viewing) >= t && !viewing.done) {
    viewing.done = true; viewing.doneAt = Date.now(); viewing.doneDay = localDay();
    viewing.finishes = [...(viewing.finishes || []), { round: roundOf(viewing), day: localDay(), at: viewing.doneAt }];
  }
  saveRecords(); render(); fillView(viewing);
  toast(`전체 ${t}쪽으로 저장했어요`);
});
$("viewDialog").addEventListener("close", () => {
  const v = $("viewDialog").returnValue;
  const r = viewing; viewing = null;
  if (!r) return;
  if (v === "more") r.done ? startReread(r) : openRecord({ existing: r });
  else if (v === "activity") openActivity(r, { pages: 0, fromFlow: false });
  else if (v === "time") { // 오늘 읽은 시간 적기 → 포트폴리오 그날 기록으로 저장, 끝나면 이 책으로 돌아옴
    openDayKey = localDay();
    openEntry(shelfOf(r));
    returnDay = null; entryBook = r.id;
    $("eWhat").value = r.title;
  }
  else if (v === "delete" && confirm(`'${r.title}' 기록을 모두 지울까요?`)) {
    records = records.filter((x) => x.id !== r.id);
    saveRecords(); render();
    toast("기록을 지웠어요");
  }
});

// ---------- 포트폴리오 (캘린더 + 날짜별 기록) ----------
const JOURNAL_KEY = "kbc:journal:v1";
let allJournal = readJSON(JOURNAL_KEY, []);
let journal = [];
const viewJournal = () => { journal = allJournal.filter(mineNow); };
const saveJournal = () => {
  for (const j of journal) if (!j.kid && activeKid) j.kid = activeKid;
  const ids = new Set(journal.map((j) => j.id));
  allJournal = [...allJournal.filter((j) => !ids.has(j.id) && !mineNow(j)), ...journal];
  store.setItem(JOURNAL_KEY, JSON.stringify(allJournal));
};
viewJournal();
const writeAll = () => {
  store.setItem(REC_KEY, JSON.stringify(allRecords));
  store.setItem(JOURNAL_KEY, JSON.stringify(allJournal));
};

// 카테고리: 사용자가 편집 가능. kind = book(책장) · focus(책장+시간) · time(한 것+시간) · note(메모만)
const CATS_KEY = "kbc:cats:v1";
const DEFAULT_CATS = [
  { key: "ko", icon: "book", name: "한글책", kind: "book" },
  { key: "en", icon: "abc", name: "영어책", kind: "book" },
  { key: "listen", icon: "headphones", name: "흘려듣기", kind: "time" },
  { key: "focus", icon: "ear", name: "집중듣기", kind: "focus" },
  { key: "memo", icon: "pencil", name: "메모", kind: "note" },
  { key: "secret", icon: "lock", name: "나만보기", kind: "note" },
];
const LEGACY_CATS = [
  { key: "math", icon: "math-symbols", name: "수학", kind: "time" },
  { key: "etc", icon: "star", name: "기타", kind: "time" },
];
const PH = { ko: "예: 고민해결사무소", en: "예: Magic Tree House 1권", listen: "예: Peppa Pig 3화", focus: "예: Magic Tree House 1권", math: "예: 연산 문제집 12~15쪽", etc: "예: 피아노 연습" };
// 카테고리마다 아이콘 색
const CAT_COLOR = { ko: "#2F5D3A", en: "#6F9F97", listen: "#C89B3C", focus: "#D4537E", memo: "#534AB7", math: "#185FA5", etc: "#BA7517", secret: "#5F5E5A" };
function decorate(c) {
  const d = { ...c, icon: toIcon(c.icon), color: CAT_COLOR[c.key] || "#2F5D3A" };
  d.svg = ico(d.icon, "", d.color);
  // 한글책 · 영어책: 스캔한 책 기록 + 포트폴리오에서 따로 적는 읽은 시간 (흘려듣기처럼)
  if (c.kind === "book") Object.assign(d, { book: true, what: "무엇을 읽었나요?", whatPh: PH[c.key] || "예: 읽은 책", amount: "얼마나 읽었나요?", unit: "분" });
  if (c.kind === "focus") d.hybrid = true;
  if (c.kind === "time" || c.kind === "focus") {
    const listen = c.key === "listen" || c.key === "focus";
    Object.assign(d, { what: listen ? "무엇을 들었나요?" : "무엇을 했나요?", whatPh: PH[c.key] || "예: 오늘 한 것", amount: "얼마나 했나요?", unit: "분" });
  }
  if (c.kind === "note") Object.assign(d, { text: c.key === "memo" ? "메모 · 일기" : c.key === "secret" ? "🔒 나만 보는 비밀 메모" : "내용", textPh: c.key === "secret" ? "여기 쓴 글과 사진은 나만 볼 수 있어요. 친구들은 책장을 구경해도 못 봐요." : "오늘 있었던 일, 느낀 점, 칭찬할 점을 일기처럼 자유롭게 적어요" });
  return d;
}
let catList = readJSON(CATS_KEY, null);
if (!Array.isArray(catList)) {
  // 처음 한 번: 기본 5개 + 이미 기록이 있는 예전 카테고리(수학·기타)
  catList = [...DEFAULT_CATS];
  for (const c of LEGACY_CATS) if (allJournal.some((j) => j.cat === c.key)) catList.splice(catList.length - 1, 0, c);
  store.setItem(CATS_KEY, JSON.stringify(catList));
}
// 기록은 있는데 목록에 없는 예전 카테고리는 다시 넣어 둠 (기록이 안 보이게 되는 일 방지)
for (const c of LEGACY_CATS) {
  if (!catList.some((x) => x.key === c.key) && allJournal.some((j) => j.cat === c.key)) {
    catList.splice(Math.max(0, catList.findIndex((x) => x.key === "memo")), 0, { ...c });
    store.setItem(CATS_KEY, JSON.stringify(catList));
  }
}
// 새 기본 카테고리 '나만보기'(비밀 메모)가 없으면 메모 다음에 넣어 둠
if (!catList.some((c) => c.key === "secret")) {
  const at = catList.findIndex((c) => c.key === "memo");
  catList.splice(at < 0 ? catList.length : at + 1, 0, { key: "secret", icon: "lock", name: "나만보기", kind: "note" });
  store.setItem(CATS_KEY, JSON.stringify(catList));
}
// 예전 이모지 아이콘은 선 아이콘 이름으로 바꿔 둠
if (catList.some((c) => c.icon !== toIcon(c.icon))) {
  catList = catList.map((c) => ({ ...c, icon: toIcon(c.icon) }));
  store.setItem(CATS_KEY, JSON.stringify(catList));
}
const saveCats = () => store.setItem(CATS_KEY, JSON.stringify(catList));
let CATS = [], CAT = {};
const refreshCats = () => {
  CAT = Object.fromEntries(catList.map((c) => [c.key, decorate(c)]));
  CATS = catList.filter((c) => !c.hidden).map((c) => CAT[c.key]);
};
refreshCats();

const booksOn = (day, shelf) => records.flatMap((r) =>
  r.sessions.filter((s) => s.day === day && shelfOf(r) === shelf).map((s) => ({ r, s })));
// 집중듣기(hybrid)는 스캔한 책 기록 + 직접 적은 기록을 모두 보여 줌
const journalOn = (day, cat) => journal.filter((j) => j.day === day && j.cat === cat);
// 책 기록이 있는 날, 그 책에 따로 적은 읽은 시간 → 책 줄에 합쳐 보여 줌
const mergedTime = (day, c, j) => !!(c.book && j.book && j.minutes && booksOn(day, c.key).some(({ r }) => r.id === j.book));
const countOn = (day, c) => (c.book || c.hybrid ? booksOn(day, c.key).length : 0) + journalOn(day, c.key).filter((j) => !mergedTime(day, c, j)).length;
const catsOn = (day) => CATS.filter((c) => countOn(day, c));

let calYM = localDay().slice(0, 7);
function renderCalendar() {
  const [y, m] = calYM.split("-").map(Number);
  $("calTitle").textContent = `${y}년 ${m}월`;
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - first.getDay());
  const today = localDay();
  let html = "", count = 0;
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i >= 35 && d.getMonth() !== m - 1) break;
    const day = localDay(d);
    const out = d.getMonth() !== m - 1;
    const cats = out ? [] : catsOn(day);
    if (cats.length) count++;
    const cls = [out && "out", day === today && "today", day === selDay && "sel", cats.length && "has"].filter(Boolean).join(" ");
    // 아이콘은 3개씩 2줄(최대 6개), 넘치면 5개 + "+숫자"
    const shown = cats.length > 6 ? cats.slice(0, 5) : cats;
    const icons = shown.map((c) => c.svg).join("") + (cats.length > 6 ? `<span class="more">+${cats.length - 5}</span>` : "");
    html += `<button type="button" class="${cls}" data-day="${day}" ${day > today || out ? "disabled" : ""} aria-label="${prettyDay(day)}${cats.length ? ` · ${cats.map((c) => c.name).join(", ")}` : ""}">
      <span class="dn">${d.getDate()}</span>${cats.length ? `<span class="ig">${icons}</span>` : ""}</button>`;
  }
  $("calGrid").innerHTML = html;
  $("calLegend").innerHTML = count ? `이번 달 <b>${count}</b>일 기록했어요` : "이 달에는 아직 기록이 없어요";
  renderDayInline();
}
// 고른 날짜의 기록을 달력 아래에 바로 보여 주기
let selDay = localDay();
function renderDayInline() {
  if (selDay > localDay()) selDay = localDay();
  const html = dayGroupsHtml(selDay);
  const n = (html.match(/class="day-item/g) || []).length;
  $("diTitle").innerHTML = `${prettyDay(selDay)}${n ? ` <small>· 기록 ${n}개</small>` : ""}`;
  $("diList").innerHTML = html || `<p class="di-empty">이 날은 아직 기록이 없어요</p>`;
  fillPhotoRows($("diList"));
}
$("diAdd").addEventListener("click", () => openDay(selDay));
$("diList").addEventListener("click", (e) => {
  if (e.target.closest(".ph-thumb")) return;
  const t = e.target.closest("[data-view],[data-del],[data-edit]"); if (!t) return;
  if (t.dataset.view) { openView(t.dataset.view); return; }
  if (PEEK) return; // 구경 중에는 보기만
  if (t.dataset.del) {
    if (!confirm("이 기록을 지울까요?")) return;
    const gone = journal.find((j) => j.id === t.dataset.del);
    if (gone?.photos?.length) sync.deletePhotos(gone.photos);
    journal = journal.filter((j) => j.id !== t.dataset.del); saveJournal(); render(); return;
  }
  const j = journal.find((x) => x.id === t.dataset.edit); if (!j || !CAT[j.cat]) return;
  openDayKey = selDay;
  openEntry(j.cat, j);
  returnDay = null; // 고친 뒤 날짜 창을 다시 열지 않고 달력으로
});
$("calPrev").addEventListener("click", () => { const [y, m] = calYM.split("-").map(Number); calYM = localDay(new Date(y, m - 2, 1)).slice(0, 7); renderCalendar(); });
$("calNext").addEventListener("click", () => { const [y, m] = calYM.split("-").map(Number); calYM = localDay(new Date(y, m, 1)).slice(0, 7); renderCalendar(); });
$("calGrid").addEventListener("click", (e) => { const b = e.target.closest("button[data-day]"); if (b && !b.disabled) { selDay = b.dataset.day; renderCalendar(); } });

// 그날 기록: 카테고리마다 한 블록
function dayGroupsHtml(day) {
  let html = "";
  for (const c of CATS) {
    let rows = "", n = 0;
    if (c.book || c.hybrid) {
      for (const { r, s } of booksOn(day, c.key)) {
        n++;
        // 한글책·영어책: 그날 따로 적은 읽은 시간은 책 줄에 같이 (집중듣기처럼 한 줄로)
        const tj = c.book ? journalOn(day, c.key).filter((j) => j.book === r.id && j.minutes) : [];
        const chips = tj.map((j) => `<button type="button" class="t-chip" data-edit="${j.id}" aria-label="읽은 시간 고치기">⏱ ${fmtMin(j.minutes)}</button>`).join("");
        rows += `<div class="day-item link" data-view="${r.id}">
          ${r.cover ? `<img src="${esc(r.cover)}" alt="">` : `<span class="noc"></span>`}
          <div class="grow"><b>${esc(r.title)}</b><small>${sessionText(s)}${chips}</small></div></div>`;
      }
    }
    {
      for (const j of journalOn(day, c.key)) {
        if (mergedTime(day, c, j)) continue; // 위 책 줄에 이미 보임
        n++;
        // 박스 제목에 종류 이름·아이콘이 있으니, 기록에는 내용만
        const mins = j.minutes ? fmtMin(j.minutes) : "";
        const note = c.kind === "note" && !j.what;
        const main = j.what || mins || c.name;
        const sub = j.what ? [mins, j.text || ""].filter(Boolean).join(" · ") : mins ? j.text || "" : "";
        rows += `<div class="day-item link" data-edit="${j.id}">${j.cover ? `<img src="${esc(j.cover)}" alt="">` : ""}
          <div class="grow">${note ? richHtml(j.text, j.photos || [], "ph-row", "dn-text") : `<b>${esc(main)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}${j.photos?.length ? `<div class="ph-row" data-paths="${esc(j.photos.join("|"))}"></div>` : ""}`}</div>
          <button type="button" class="x" data-del="${j.id}" aria-label="지우기">✕</button></div>`;
      }
    }
    if (n) html += `<section class="day-group"><h4 class="dg-head" style="color:${c.color}">${c.svg}<b>${esc(c.name)}</b><small>${n}</small></h4>${rows}</section>`;
  }
  return html;
}
// 날짜 시트
let openDayKey = null;  // 지금 열려 있는 날짜
let returnDay = null;   // 다른 창을 다 쓰고 나면 돌아올 날짜 (기록 날짜 기본값으로도 사용)
let dayPanel = null;    // 한글책/영어책 버튼을 눌렀을 때 펼치는 패널
function openDay(day) {
  openDayKey = day; returnDay = day;
  fillDay(day);
  if (!$("dayDialog").open) $("dayDialog").showModal();
}
function fillDay(day) {
  const [, m, d] = day.split("-").map(Number);
  $("dayTitle").innerHTML = `${m}월 ${d}일에<br>무엇을 기록할까요?`;
  $("dayCats").innerHTML = CATS.map((c) => {
    const n = countOn(day, c);
    return `<button type="button" data-cat="${c.key}" class="${dayPanel === c.key ? "on" : ""}"><span class="ic">${c.svg}</span>${c.name}${n ? `<span class="cnt">${n}</span>` : ""}</button>`;
  }).join("");

  let html = "";
  if (dayPanel) {
    const c = CAT[dayPanel];
    const ongoing = records.filter((r) => shelfOf(r) === dayPanel && !r.done);
    html += `<div class="day-actions">
        <button type="button" class="btn lime" data-act="scan">📷 책 스캔</button>
        <button type="button" class="btn ghost ic-btn" data-act="title" style="background:var(--soft)">${ico("search")} 책 검색</button>
        ${c.hybrid ? `<button type="button" class="btn ghost" data-act="entry" style="background:var(--soft)">✏️ 직접 적기</button>` : c.book ? `<button type="button" class="btn ghost ic-btn" data-act="entry" style="background:var(--soft)">⏱ 읽은 시간 적기</button>` : ""}
      </div>`;
    html += ongoing.length ? `<small>읽고 있는 ${c.name} (누르면 이 날 읽은 쪽수를 기록해요)</small>` +
      ongoing.map((r) => `<div class="day-item link" data-more="${r.id}">
        ${r.cover ? `<img src="${esc(r.cover)}" alt="">` : `<span>${c.svg}</span>`}
        <div class="grow"><b>${esc(r.title)}</b><small>${progressText(r) || "아직 쪽수 기록 없음"}</small></div><span>➕</span></div>`).join("")
      : `<small>읽고 있는 ${c.name} 책이 없어요. 책 스캔으로 새 책을 기록해 보세요.</small>`;
  } else {
    html = dayGroupsHtml(day);
    if (!html) html = `<small style="text-align:center">아직 이 날의 기록이 없어요. 위 카테고리를 눌러 기록해 보세요.</small>`;
  }
  $("dayList").innerHTML = html;
  fillPhotoRows($("dayList"));
}
// 일기 사진 보여 주기 (누르면 크게)
async function fillPhotoRows(root) {
  for (const row of root.querySelectorAll(".ph-row[data-paths]")) {
    const urls = await sync.photoUrls(row.dataset.paths.split("|"));
    row.innerHTML = urls.map((u) => (u ? `<button type="button" class="ph-thumb" data-full="${esc(u)}"><img src="${esc(u)}" alt="일기 사진" loading="lazy"></button>` : `<span class="ph-thumb off"></span>`)).join("");
  }
}
document.addEventListener("click", (e) => {
  const t = e.target.closest(".ph-thumb[data-full]"); if (!t) return;
  const all = [...t.parentElement.querySelectorAll("[data-full]")].map((x) => x.dataset.full);
  openPhoto(all, all.indexOf(t.dataset.full));
});
let photoList = [], photoAt = 0;
function openPhoto(list, i) {
  photoList = list; photoAt = i;
  showPhoto();
  if (!$("photoView").open) $("photoView").showModal();
}
function showPhoto() {
  $("pvImg").src = photoList[photoAt];
  $("pvCount").textContent = photoList.length > 1 ? `${photoAt + 1} / ${photoList.length}` : "";
  $("pvPrev").hidden = $("pvNext").hidden = photoList.length < 2;
}
$("pvPrev").addEventListener("click", () => { photoAt = (photoAt + photoList.length - 1) % photoList.length; showPhoto(); });
$("pvNext").addEventListener("click", () => { photoAt = (photoAt + 1) % photoList.length; showPhoto(); });
$("pvImg").addEventListener("click", () => $("photoView").close());
$("dayCats").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-cat]"); if (!b) return;
  const c = CAT[b.dataset.cat];
  if (c.book || c.hybrid) { dayPanel = dayPanel === c.key ? null : c.key; fillDay(openDayKey); return; }
  openEntry(c.key);
});
$("dayList").addEventListener("click", (e) => {
  if (e.target.closest(".ph-thumb")) return; // 사진은 크게 보기
  const t = e.target.closest("[data-act],[data-more],[data-view],[data-del],[data-edit]"); if (!t) return;
  const day = openDayKey;
  if (t.dataset.edit) {
    if (PEEK) return; // 구경 중에는 보기만
    const j = journal.find((x) => x.id === t.dataset.edit); if (!j || !CAT[j.cat]) return;
    openEntry(j.cat, j);
    return;
  }
  if (t.dataset.del) {
    if (!confirm("이 기록을 지울까요?")) return;
    const gone = journal.find((j) => j.id === t.dataset.del);
    if (gone?.photos?.length) sync.deletePhotos(gone.photos);
    journal = journal.filter((j) => j.id !== t.dataset.del); saveJournal(); render(); return;
  }
  // 다른 창을 열기 전에 날짜 시트를 잠시 닫고, 끝나면 다시 돌아옴
  $("dayDialog").close("away"); returnDay = day;
  preferShelf = dayPanel;
  if (t.dataset.act === "scan") openScanner();
  else if (t.dataset.act === "isbn") openManual();
  else if (t.dataset.act === "title") openTitle();
  else if (t.dataset.act === "entry") { openDayKey = day; openEntry(dayPanel); }
  else if (t.dataset.more) openRecord({ existing: records.find((r) => r.id === t.dataset.more) });
  else if (t.dataset.view) openView(t.dataset.view);
});
$("dayDialog").addEventListener("close", () => {
  if ($("dayDialog").returnValue !== "away") { returnDay = null; dayPanel = null; }
  openDayKey = null;
});
// 다른 창이 모두 닫히면 날짜 시트로 돌아오기
function maybeReturn() {
  setTimeout(() => {
    if (returnDay && !document.querySelector("dialog[open]") && $("scanner").hidden && $("burst").hidden) openDay(returnDay);
  }, 80);
}
["scanSheet", "recordPage", "finishSheet", "activityPage", "stampPage", "viewDialog", "manualDialog", "entryDialog"]
  .forEach((id) => $(id).addEventListener("close", maybeReturn));

// 카테고리 기록 입력
let entryCat = null;
// entry 가 있으면 그 기록 고치기
let editEntry = null;
function openEntry(cat, entry = null) {
  const c = CAT[cat]; entryCat = cat; editEntry = entry;
  $("eTitle").textContent = `${c.name}${c.book ? " 읽은 시간" : ""}${entry ? " 고치기" : ""} · ${prettyDay(entry?.day || openDayKey)}`;
  // 수학: 문제집을 검색해서 고르면 표지가 함께 남아요
  eCover = entry?.cover || "";
  // 흘려듣기: 영화·TV를 검색해서 고르면 포스터가 함께 남아요
  const eMode = cat === "math" || /수학/.test(c.name) ? "workbook" : cat === "listen" ? "media" : null;
  $("eBook").hidden = !eMode; $("eBook").dataset.mode = eMode || "";
  $("eFindTxt").textContent = eMode === "media" ? "영상 검색" : "문제집 검색";
  paintECover();
  $("eWhatWrap").hidden = !c.what; $("eWhatLabel").textContent = c.what || ""; $("eWhat").placeholder = c.whatPh || ""; $("eWhat").value = "";
  $("eAmountWrap").hidden = !c.amount; $("eAmountLabel").textContent = (c.amount || "").replace("몇 분", "얼마나"); $("eUnit").textContent = c.unit || ""; $("eAmount").value = ""; $("eHour").value = "";
  $("eTextWrap").hidden = false; $("eTextLabel").textContent = c.text || "한 줄 메모 (선택)"; $("eText").placeholder = c.textPh || ""; $("eText").value = "";
  $("eText").rows = c.kind === "note" ? 9 : c.text ? 5 : 2;
  eRich.photos().forEach((p) => p.file && URL.revokeObjectURL(p.url));
  const isNote = c.kind === "note";
  $("eTextWrap").hidden = isNote; $("eRichWrap").hidden = !isNote;
  const items = (entry?.photos || []).map((path) => ({ path, url: "" }));
  eRich.set(isNote ? entry?.text || "" : "", items);
  if (entry) {
    $("eWhat").value = entry.what || ""; $("eText").value = isNote ? "" : entry.text || "";
    if (entry.minutes) { $("eHour").value = Math.floor(entry.minutes / 60) || ""; $("eAmount").value = entry.minutes % 60 || ""; }
    const paths = entry.photos || [];
    if (paths.length) sync.photoUrls(paths).then((urls) => {
      const map = new Map(paths.map((pa, i) => [pa, urls[i]]));
      items.forEach((p) => { if (p.path) p.url = map.get(p.path) || ""; });
      eRich.refresh();
    });
  }
  paintPhotos();
  $("dayDialog").close("away"); returnDay = openDayKey || returnDay;
  $("entryDialog").showModal();
}
// 일기 사진: 최대 10장, 올리기 전에 작게 줄임(긴 쪽 1280px)
const MAX_PHOTOS = 10; // 한 글에 사진 최대 장수
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 한 장 최대 5MB (올리기 전에 긴 쪽 1280px로 줄여서 보통 0.5MB 아래)
// 메모: 사진이 글 사이에 들어감 (도구줄의 📷 사진)
const eRich = makeRich($("eRich"), { placeholder: "오늘 있었던 일을 적어 보세요", max: MAX_PHOTOS, onChange: (gone) => { if (gone?.file) URL.revokeObjectURL(gone.url); paintPhotos(); } });
function paintPhotos() {
  const n = eRich.photos().length;
  $("ePhotoCount").textContent = `사진 ${n}/${MAX_PHOTOS}`;
  $("ePhotoAdd").disabled = n >= MAX_PHOTOS;
}
const pickImages = (input) => [...input.files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
$("ePhotoAdd").addEventListener("mousedown", (e) => e.preventDefault()); // 글 쓰던 자리를 놓치지 않게
$("ePhotoAdd").addEventListener("click", () => $("ePhotoFile").click());
$("ePhotoFile").addEventListener("change", () => {
  const files = pickImages($("ePhotoFile"));
  const room = MAX_PHOTOS - eRich.photos().length;
  if (files.length > room) toast(`사진은 ${MAX_PHOTOS}장까지 넣을 수 있어요`);
  eRich.insert(files.slice(0, room).map((f) => ({ file: f, url: URL.createObjectURL(f) })));
  $("ePhotoFile").value = "";
  paintPhotos();
});
// 쓴 순서대로 사진을 올리고, 못 올린 사진 자리는 글에서 뺌 → { body, paths }
async function uploadRich({ body, items }, folder, skip = false) {
  const ok = [], paths = [];
  let tried = 0;
  for (const it of items) {
    if (it.path) { ok.push(true); paths.push(it.path); continue; }
    if (skip) { ok.push(false); continue; }
    tried++;
    toast(`사진 올리는 중 ${tried}/${items.filter((x) => x.file).length}`, 60000);
    try {
      const blob = await shrinkPhoto(it.file);
      if (blob.size > MAX_PHOTO_BYTES) throw new Error("big"); // 줄인 뒤에도 5MB 넘으면 뺌
      paths.push(await sync.uploadPhoto(blob, folder)); ok.push(true);
    } catch { ok.push(false); }
  }
  let k = 0;
  const out = body.split("\n").filter((l) => (l.trim() === MARK ? ok[k++] : true)).join("\n").trim();
  return { body: out, paths, failed: ok.filter((x) => !x).length };
}
async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  const s = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", 0.82));
}
let eCover = "";
function paintECover() { $("eBookImg").hidden = !eCover; if (eCover) $("eBookImg").src = eCover; }
$("eFind").addEventListener("click", () => openTitle($("eBook").dataset.mode || "workbook", (b) => { $("eWhat").value = b.title; eCover = b.cover || ""; paintECover(); }));
$("eWhat").addEventListener("input", () => { if (eCover) { eCover = ""; paintECover(); } }); // 이름을 고치면 표지는 뺌
$("entryDialog").addEventListener("close", () => { // 책 기록 보기에서 왔으면 그 책으로 돌아가기
  const id = entryBook; if (!id) return;
  setTimeout(() => { entryBook = null; if (!document.querySelector("dialog[open]")) openView(id); }, 120);
});
$("entryDialog").addEventListener("close", async () => {
  if ($("entryDialog").returnValue !== "save" || !entryCat) return;
  const cat = entryCat; entryCat = null;
  const old = editEntry; editEntry = null;
  const isNote = CAT[cat].kind === "note";
  const rich = isNote ? eRich.get() : { body: "", items: [] };
  const what = $("eWhat").value.trim(), text = isNote ? rich.body : $("eText").value.trim(), minutes = ((parseInt($("eHour").value, 10) || 0) * 60 + (parseInt($("eAmount").value, 10) || 0)) || null;
  const all = rich.items;
  const kept = all.filter((p) => p.path).map((p) => p.path);
  const picked = all.filter((p) => p.file);
  if (!what && !text && !minutes && !all.length) { toast("내용을 적어 주세요"); return; }
  const entry = old || { id: crypto.randomUUID?.() || String(Date.now()), day: returnDay || localDay(), cat, ...(entryBook ? { book: entryBook } : {}) };
  if (old) {
    const removed = (old.photos || []).filter((p) => !kept.includes(p));
    if (removed.length) sync.deletePhotos(removed);
  }
  Object.assign(entry, { what, minutes, text });
  if (eCover && what) entry.cover = eCover; else delete entry.cover;
  if (kept.length) entry.photos = kept; else delete entry.photos;
  if (picked.length) {
    if (!sync.canUpload()) {
      toast("사진은 인터넷에 연결돼 있을 때 올릴 수 있어요. 글만 저장했어요", 3500);
      entry.text = (await uploadRich({ body: text, items: all }, "", true)).body;
    } else {
      const up = await uploadRich({ body: text, items: all }, cat === "secret" ? "private" : "");
      entry.text = up.body;
      if (up.paths.length) entry.photos = up.paths; else delete entry.photos;
      if (up.failed) toast(`사진 ${up.failed}장은 올리지 못했어요`, 3500);
    }
    picked.forEach((p) => URL.revokeObjectURL(p.url));
  }
  if (!old) journal.push(entry);
  saveJournal(); render();
  if (!picked.length || (entry.photos?.length || 0) === kept.length + picked.length) toast(`${CAT[cat].name} ${old ? "고쳤어요" : "기록했어요"}${entry.photos ? ` · 사진 ${entry.photos.length}장` : ""}`);
});

// ---------- 소식: 통계 ----------
let catFilter = "all";
$("catFilter").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-f]"); if (!b) return;
  catFilter = b.dataset.f;
  [...$("catFilter").children].forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  renderStats();
});
function renderStats() {
  const kidNow = kids.find((k) => k.id === activeKid);
  $("statsTitle").textContent = kidNow ? `${kidNow.nick} 독서 통계` : "독서 통계";
  // 통계 볼 아이 고르기 (아이가 둘 이상일 때)
  $("statKids").hidden = kids.length < 2;
  $("statKids").innerHTML = kids.map((k) => `<button type="button" class="kid${k.id === activeKid ? " on" : ""}" data-kid="${k.id}">${esc(k.nick)}${gradeOf(k) ? ` <small class="grade">${gradeOf(k)}</small>` : ""}</button>`).join("");
  const pages = readRecs().reduce((a, r) => a + pagesOf(r), 0);
  // 책 읽은 시간: 포트폴리오에 적은 한글책·영어책 시간 (+ 예전에 책 기록에 적은 시간)
  const readMins = readRecs().reduce((a, r) => a + minsOf(r), 0) + journal.filter((j) => (j.cat === "ko" || j.cat === "en") && j.minutes).reduce((a, j) => a + j.minutes, 0);
  const focusMins = records.filter(isFo).reduce((a, r) => a + minsOf(r), 0) + journal.filter((j) => j.cat === "focus").reduce((a, j) => a + (j.minutes || 0), 0);
  const recDays = new Set([...records.flatMap((r) => r.sessions.map((s) => s.day)), ...journal.map((j) => j.day)]).size;
  $("statTiles").innerHTML = [
    ["읽은 책", readRecs().length, "권"], ["기록한 날", recDays, "일"],
    ["읽은 쪽수", pages.toLocaleString(), "쪽"], ["독서 포인트", totalPoints().toLocaleString(), "점"],
    ["책 읽은 시간", readMins ? fmtMin(readMins) : "-", ""], ["집중듣기 시간", fmtMin(focusMins), ""],
  ].map(([k, v, u]) => `<div class="tile"><small>${k}</small><b>${v}<em>${u}</em></b></div>`).join("");

  // 한글책 / 영어책 / 집중듣기
  const groups = Object.keys(SHELVES).map((k) => {
    const list = records.filter((r) => shelfOf(r) === k);
    const jm = journal.filter((j) => j.cat === k && j.minutes).reduce((a, j) => a + j.minutes, 0); // 포트폴리오에 따로 적은 시간 (그래프와 같은 기준)
    return { k, n: list.length, p: list.reduce((a, r) => a + pagesOf(r), 0), m: list.reduce((a, r) => a + minsOf(r), 0) + jm, color: `var(--${k === "focus" ? "fo" : k})` };
  });
  const sum = groups.reduce((a, g) => a + g.n, 0);
  $("statSplit").innerHTML = sum ? `
    <div class="split-bar" role="img" aria-label="${groups.map((g) => `${shelfName(g.k)} ${g.n}권`).join(", ")}">
      ${groups.filter((g) => g.n).map((g) => `<i style="width:${(g.n / sum) * 100}%;background:${g.color}" title="${shelfName(g.k)} ${g.n}권"></i>`).join("")}
    </div>
    <div class="split-legend">
      ${groups.map((g) => `<span><i style="background:${g.color}"></i>${shelfName(g.k)} <b>${g.n}권</b> <em>${g.k === "focus" ? fmtMin(g.m) : g.p.toLocaleString() + "쪽" + (g.m ? ` · ${fmtMin(g.m)}` : "")}</em></span>`).join("")}
    </div>` : `<p class="empty">아직 기록이 없어요</p>`;

  // 분야별
  const pool = catFilter === "all" ? records : records.filter((r) => shelfOf(r) === catFilter);
  const byCat = {};
  for (const r of pool) { const k = r.category || "미분류"; byCat[k] = (byCat[k] || 0) + 1; }
  const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map((x) => x[1]));
  const color = catFilter === "ko" ? "var(--ko)" : catFilter === "en" ? "var(--en)" : catFilter === "focus" ? "var(--fo)" : "#4C6EF5";
  $("statCats").innerHTML = rows.length ? rows.map(([k, v]) => `
    <div class="hbar" title="${esc(k)} ${v}권"><span>${esc(k)}</span>
      <div class="track"><div class="fill" style="width:${(v / max) * 82}%;background:${color}"></div><span class="val">${v}권</span></div></div>`).join("") +
    (byCat["미분류"] ? `<p class="none">‘미분류’ 책은 책장에서 책을 눌러 분야를 골라 줄 수 있어요</p>` : "")
    : `<p class="none">아직 기록이 없어요</p>`;

  // 최근 6개월 쪽수
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => localDay(new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)).slice(0, 7));
  const mp = Object.fromEntries(months.map((m) => [m, 0]));
  for (const r of readRecs()) for (const s of r.sessions) { const m = s.day.slice(0, 7); if (m in mp) mp[m] += sessionPages(s); }
  const mmax = Math.max(1, ...Object.values(mp));
  renderTimeChart();
  renderMath();
  $("statMonths").innerHTML = months.map((m) => `
    <div class="vbar" title="${m} ${mp[m]}쪽">${mp[m] ? `<b>${mp[m]}</b>` : ""}<i style="height:${(mp[m] / mmax) * 82}%"></i><small>${Number(m.slice(5))}월</small></div>`).join("");
}

// ---------- 소식: 수학 공부 시간 (일평균 · 월평균 · 달마다) ----------
const isMath = (j) => j.cat === "math" || /수학/.test(CAT[j.cat]?.name || "");
function renderMath() {
  const ms = journal.filter((j) => isMath(j) && j.minutes);
  const hasCat = CATS.some((c) => c.key === "math" || /수학/.test(c.name));
  $("mathWrap").hidden = !hasCat && !ms.length;
  if ($("mathWrap").hidden) return;
  const now = new Date(), thisM = localDay().slice(0, 7);
  const byDay = {}, byMonth = {};
  for (const j of ms) { byDay[j.day] = (byDay[j.day] || 0) + j.minutes; const m = j.day.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + j.minutes; }
  // 일평균: 이번 달 1일부터 오늘까지 모든 날로 나눔 / 월평균: 기록이 있는 달 기준
  const daysThis = Object.keys(byDay).filter((d) => d.startsWith(thisM));
  const totThis = byMonth[thisM] || 0, passed = now.getDate();
  const dayAvg = totThis ? Math.round(totThis / passed) : 0;
  const mKeys = Object.keys(byMonth);
  const monAvg = mKeys.length ? Math.round(mKeys.reduce((a, m) => a + byMonth[m], 0) / mKeys.length) : 0;
  $("mathTotals").innerHTML = [
    ["하루 평균", dayAvg ? fmtMin(dayAvg) : "-", daysThis.length ? `${passed}일 중 ${daysThis.length}일 공부` : "이번 달 기록 없음"],
    ["한 달 평균", monAvg ? fmtMin(monAvg) : "-", mKeys.length ? `${mKeys.length}달 기록` : "기록 없음"],
    [`${now.getMonth() + 1}월 모두`, totThis ? fmtMin(totThis) : "-", ""],
  ].map(([n, v, s]) => `<div><small>${n}</small><b>${v}</b>${s ? `<em>${s}</em>` : ""}</div>`).join("");
  const months = Array.from({ length: 6 }, (_, i) => localDay(new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)).slice(0, 7));
  const mmax = Math.max(1, ...months.map((m) => byMonth[m] || 0));
  $("mathMonths").innerHTML = months.map((m) => { const v = byMonth[m] || 0; return `
    <div class="vbar" title="${Number(m.slice(5))}월 ${fmtMin(v)}">${v ? `<b>${fmtMin(v)}</b>` : ""}<i style="height:${(v / mmax) * 78}%;background:#185FA5"></i><small>${Number(m.slice(5))}월</small></div>`; }).join("");
  $("mathInfo").textContent = ms.length ? "포트폴리오에서 수학을 적은 시간으로 계산해요" : "포트폴리오 수학 칸에 공부한 시간을 적으면 여기에 모여요";
}

// ---------- 소식: 읽은 시간 그래프 (이번 주 = 요일별 / 한 달 = 주별, 세로는 시간) ----------
let timeRange = "w";
const TKIND = [["ko", "한글책", "#2F5D3A"], ["en", "영어책", "#6F9F97"], ["fo", "집중듣기", "#C89B3C"]];
function minutesByDay() { // { "2026-11-25": { ko, en, fo } }
  const m = {};
  const add = (day, k, v) => { if (!v) return; (m[day] ||= { ko: 0, en: 0, fo: 0 })[k] += v; };
  for (const r of records) { const k = isFo(r) ? "fo" : shelfOf(r) === "en" ? "en" : "ko"; for (const s of r.sessions) add(s.day, k, s.minutes || 0); }
  for (const j of journal) { const k = j.cat === "focus" ? "fo" : j.cat === "ko" || j.cat === "en" ? j.cat : null; if (k) add(j.day, k, j.minutes || 0); }
  return m;
}
function renderTimeChart() {
  const md = minutesByDay(), now = new Date(), today = localDay();
  let cols = [];
  if (timeRange === "w") { // 월요일부터 일요일까지
    const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    cols = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); const day = localDay(d); return { label: "월화수목금토일"[i], days: [day], title: prettyDay(day), future: day > today }; });
  } else { // 이번 달을 7일씩
    const y = now.getFullYear(), mo = now.getMonth(), last = new Date(y, mo + 1, 0).getDate();
    for (let s = 1, w = 1; s <= last; s += 7, w++) {
      const days = []; for (let d = s; d <= Math.min(last, s + 6); d++) days.push(localDay(new Date(y, mo, d)));
      cols.push({ label: `${w}주`, days, title: `${mo + 1}월 ${s}~${Math.min(last, s + 6)}일`, future: days[0] > today });
    }
  }
  for (const c of cols) { c.v = { ko: 0, en: 0, fo: 0 }; for (const d of c.days) if (md[d]) for (const k of ["ko", "en", "fo"]) c.v[k] += md[d][k]; c.t = c.v.ko + c.v.en + c.v.fo; }
  const tot = { ko: 0, en: 0, fo: 0 }; for (const c of cols) for (const k in tot) tot[k] += c.v[k];
  $("timeTotals").innerHTML = TKIND.map(([k, n, col]) => `<div><small><i style="background:${col}"></i>${n}</small><b>${tot[k] ? fmtMin(tot[k]) : "-"}</b></div>`).join("");
  // 세로축: 시간 단위 (가장 긴 막대를 넉넉히 담는 정수 시간)
  const maxH = Math.max(1, Math.ceil(Math.max(0, ...cols.map((c) => c.t)) / 60));
  const step = maxH <= 4 ? 1 : maxH <= 8 ? 2 : Math.ceil(maxH / 4);
  const top = Math.ceil(maxH / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  $("timeChart").innerHTML = `<div class="tc-y">${ticks.slice().reverse().map((h) => `<span>${h ? `${h}시간` : "0"}</span>`).join("")}</div>
    <div class="tc-plot">${ticks.map((h) => `<i class="tc-g" style="bottom:${(h / top) * 100}%"></i>`).join("")}
    <div class="tc-cols" style="grid-template-columns:repeat(${cols.length},1fr)">${cols.map((c, i) => `<button type="button" class="tc-col${c.future ? " fut" : ""}" data-i="${i}" aria-label="${c.title} ${fmtMin(c.t)}">
      <span class="tc-stack" style="height:${(c.t / 60 / top) * 100}%">${TKIND.map(([k, , col]) => (c.v[k] ? `<em style="flex:${c.v[k]};background:${col}"></em>` : "")).join("")}</span><small>${c.label}</small></button>`).join("")}</div></div>`;
  const all = tot.ko + tot.en + tot.fo;
  $("timeInfo").textContent = all ? `${timeRange === "w" ? "이번 주" : `${now.getMonth() + 1}월`} 모두 ${fmtMin(all)} · 막대를 누르면 자세히 보여요` : "아직 적은 시간이 없어요. 포트폴리오나 책 기록 보기에서 읽은 시간을 적어 보세요.";
  $("timeChart").onclick = (e) => {
    const b = e.target.closest(".tc-col"); if (!b) return;
    const c = cols[Number(b.dataset.i)];
    [...$("timeChart").querySelectorAll(".tc-col")].forEach((x) => x.classList.toggle("on", x === b));
    $("timeInfo").textContent = c.t ? `${c.title} · ${TKIND.filter(([k]) => c.v[k]).map(([k, n]) => `${n} ${fmtMin(c.v[k])}`).join(" · ")}` : `${c.title} · 기록 없음`;
  };
}
$("timeRange").addEventListener("click", (e) => {
  const b = e.target.closest("[data-r]"); if (!b) return;
  timeRange = b.dataset.r;
  [...$("timeRange").children].forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  renderTimeChart();
});

// ---------- 스캐너 ----------
const scanner = new Scanner({
  video: $("video"),
  roiEl: $("roi"),
  onStatus: (msg) => ($("scanHint").textContent = msg),
  onDetect: (info) => {
    beep();
    $("roi").classList.add("hit");
    setTimeout(() => { closeScanner(); openSheet(info.isbn, info); }, 120);
  },
});
async function openScanner() {
  $("scanner").hidden = false;
  $("roi").classList.remove("hit");
  $("scanHint").textContent = "바코드를 네모 안에 맞춰 주세요";
  $("engine").textContent = "카메라 준비 중…";
  try {
    await scanner.start();
    $("engine").textContent = `인식 엔진: ${scanner.engine} · EAN-13 전용`;
    $("torchBtn").hidden = !scanner.caps?.torch;
    if (scanner.caps?.zoom) {
      const z = scanner.caps.zoom;
      Object.assign($("zoom"), { min: z.min, max: Math.min(z.max, 5), step: z.step || 0.1 });
      $("zoom").value = scanner.track.getSettings().zoom ?? 1;
      $("zoomWrap").hidden = false;
    } else $("zoomWrap").hidden = true;
  } catch (e) {
    closeScanner(); maybeReturn();
    toast(e.name === "NotAllowedError" ? "카메라 권한을 허용해 주세요." : "카메라를 열 수 없어요. ISBN을 직접 입력해 주세요.", 3200);
  }
}
function closeScanner() {
  scanner.stop();
  $("scanner").hidden = true;
  $("torchBtn").classList.remove("on");
}
$("fab").addEventListener("click", () => { returnDay = null; preferShelf = null; openScanner(); });
$("closeScan").addEventListener("click", () => { closeScanner(); maybeReturn(); });
$("scanManual").addEventListener("click", () => { closeScanner(); openManual(); });
$("scanTitle").addEventListener("click", () => { closeScanner(); openTitle(); });
// ---------- 바코드(ISBN) 없는 책: 제목으로 등록 ----------
const normTitle = (t) => (t || "").toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
// 책 검색: mode "book" = 책 기록하기 / "workbook" = 수학 문제집 고르기 (onPick 으로 돌려줌)
let tMode = "book", tPick = null, tFoundList = [], tTimer = null, tSeq = 0;
function openTitle(mode = "book", onPick = null) {
  tMode = mode; tPick = onPick;
  $("tHead").textContent = mode === "workbook" ? "문제집 검색" : mode === "media" ? "영상 검색" : "책 검색";
  $("tIn").placeholder = mode === "workbook" ? "문제집 이름 (예: 디딤돌 초등수학)" : mode === "media" ? "영화·TV 이름 (예: 주토피아)" : "책 제목을 입력해 주세요";
  $("tNew").textContent = mode === "book" ? "제목으로 직접 기록" : "이 이름으로 적기";
  $("tTmdb").hidden = mode !== "media";
  $("tIn").value = ""; $("tMine").innerHTML = ""; $("tFound").innerHTML = ""; tFoundList = [];
  $("titleDialog").showModal();
  setTimeout(() => $("tIn").focus(), 50);
}
async function tSearch() {
  const q = $("tIn").value.trim(), my = ++tSeq;
  if (q.length < (tMode === "media" ? 1 : 2)) { $("tFound").innerHTML = ""; return; }
  $("tFound").innerHTML = `<small>찾는 중…</small>`;
  try {
    const r = await fetch(`/api/${tMode === "media" ? "media" : "search"}?q=${encodeURIComponent(q)}`);
    const list = r.ok ? (await r.json()).results || [] : [];
    if (my !== tSeq) return; // 그 사이 다시 친 글자가 있으면 버림
    tFoundList = list;
    const media = tMode === "media";
    $("tFound").innerHTML = list.length ? `<small>찾은 ${media ? "영상" : "책"} · 눌러서 골라요</small>` + list.map((b, i) => `<button type="button" class="find-item${media ? " poster" : ""}" data-f="${i}">
        ${b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy">` : `<span class="noimg"></span>`}
        <span><b>${esc(b.title)}</b><small>${esc(media ? [b.kind, b.year, b.original !== b.title && b.original].filter(Boolean).join(" · ") : [(b.authors || []).join(", "), b.publisher, b.pages && `${b.pages}쪽`].filter(Boolean).join(" · "))}</small></span></button>`).join("")
      : `<small>찾지 못했어요. 아래 버튼으로 ${tMode === "book" ? "제목만 적어 기록할" : "이름을 그대로 적을"} 수 있어요.</small>`;
  } catch { if (my === tSeq) $("tFound").innerHTML = `<small>찾지 못했어요. 인터넷 연결을 확인해 주세요.</small>`; }
}
$("tIn").addEventListener("input", () => {
  const q = normTitle($("tIn").value);
  const hits = tMode !== "book" || q.length < 2 ? [] : records.filter((r) => normTitle(r.title).includes(q)).slice(0, 5);
  $("tMine").innerHTML = hits.length ? `<small>내 책장에 있는 책이면 눌러 주세요</small>` + hits.map((r) => `<button type="button" class="find-item" data-id="${r.id}">
      ${r.cover ? `<img src="${esc(r.cover)}" alt="">` : `<span class="noimg"></span>`}
      <span><b>${esc(r.title)}</b><small>${esc(progressText(r) || "")}</small></span></button>`).join("") : "";
  clearTimeout(tTimer); tTimer = setTimeout(tSearch, 500); // 치는 대로 찾기
});
$("tIn").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(tTimer); tSearch(); } });
$("tMine").addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]"); if (!b) return;
  const r = records.find((x) => x.id === b.dataset.id); if (!r) return;
  $("titleDialog").close("pick");
  r.done ? startReread(r) : openRecord({ existing: r });
});
$("tFound").addEventListener("click", (e) => {
  const t = e.target.closest("[data-f]"); if (!t) return;
  const b = tFoundList[Number(t.dataset.f)]; if (!b) return;
  if (tMode !== "book") { $("titleDialog").close("pick"); tPick?.(b); return; }
  $("titleDialog").close("pick");
  openRecord({ self: true, book: { title: b.title, authors: b.authors || [], publisher: b.publisher || "", cover: b.cover || "", pages: b.pages || null } });
});
$("titleDialog").addEventListener("close", () => {
  const v = $("titleDialog").returnValue, t = $("tIn").value.trim();
  if (tMode !== "book") { if (v === "new" && t) tPick?.({ title: t }); return; }
  if (v === "pick") return;
  if (v !== "new") { maybeReturn(); return; }
  openRecord({ self: true, book: { title: t } });
  if (t.length >= 2) $("rFind").click();
});
$("zoom").addEventListener("input", (e) => scanner.setZoom(Number(e.target.value)));
$("torchBtn").addEventListener("click", async () => {
  const on = !$("torchBtn").classList.contains("on");
  if (await scanner.setTorch(on)) $("torchBtn").classList.toggle("on", on);
});
document.addEventListener("visibilitychange", () => { if (document.hidden && !$("scanner").hidden) closeScanner(); });

// ---------- 직접 입력 ----------
function openManual() {
  $("manualIsbn").value = ""; $("manualErr").textContent = "";
  $("manualDialog").showModal();
}
$("manualDialog").addEventListener("close", () => {
  if ($("manualDialog").returnValue !== "ok") return;
  const isbn = toIsbn13($("manualIsbn").value);
  if (!isbn) { toast("올바른 ISBN이 아니에요. 숫자를 다시 확인해 주세요."); return; }
  openSheet(isbn, null);
});

// Enter를 누르면 '취소'가 아니라 주 버튼이 눌리도록: 취소·닫기 버튼은 제출 버튼에서 빼고 직접 닫음
document.querySelectorAll('dialog button[value="cancel"], dialog button[value="close"]').forEach((b) => {
  b.type = "button";
  b.addEventListener("click", () => b.closest("dialog").close(b.value));
});

// ---------- 학년 (3월마다 한 칸씩 자동으로 올라감) ----------
const GRADES = ["3세", "4세", "5세", "6세", "7세", "초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3", "졸업"];
function schoolYear(d = new Date()) { return d.getMonth() >= 2 ? d.getFullYear() : d.getFullYear() - 1; }
function gradeIdx(k) {
  if (k.grade == null || k.gradeYear == null) return -1;
  return Math.min(GRADES.length - 1, Math.max(0, k.grade + schoolYear() - k.gradeYear));
}
function gradeOf(k) { const i = gradeIdx(k); return i < 0 ? "" : GRADES[i]; }

// ---------- 자녀 바 ----------
function renderKids() {
  $("kidBar").hidden = !kids.length;
  $("kidBar").innerHTML = kids.map((k) => `<button type="button" class="kid${k.id === activeKid ? " on" : ""}" data-kid="${k.id}">${esc(k.nick)}${gradeOf(k) ? ` <small class="grade">${gradeOf(k)}</small>` : ""}</button>`).join("") +
    `<button type="button" class="kid add" data-kid="+" aria-label="자녀 추가·관리">＋</button>`;
}
function setKid(id) {
  activeKid = id; saveKids();
  viewRecords(); viewJournal();
  $("monthFilter").value = "all";
  renderKids(); render();
}
$("statKids").addEventListener("click", (e) => {
  const b = e.target.closest("[data-kid]"); if (b && b.dataset.kid !== activeKid) setKid(b.dataset.kid);
});
$("kidBar").addEventListener("click", (e) => {
  const b = e.target.closest("[data-kid]"); if (!b) return;
  if (b.dataset.kid === "+") openKids(false);
  else if (b.dataset.kid !== activeKid) setKid(b.dataset.kid);
});

// ---------- 자녀 등록 · 관리 ----------
let kidsFirst = false, kidDraft = [];
function openKids(first) {
  kidsFirst = first;
  kidDraft = kids.map((k) => ({ id: k.id, nick: k.nick, g: gradeIdx(k) }));
  if (!kidDraft.length) kidDraft.push({ id: uid(), nick: "", g: -1 });
  $("kTitle").textContent = first ? "반가워요! 자녀를 등록해 주세요 🍌" : "자녀 관리";
  $("kCancel").hidden = first;
  paintKids();
  $("kidsDialog").showModal();
  if (first) setTimeout(() => $("kList").querySelector("input")?.focus(), 50);
}
function syncKids() {
  $("kList").querySelectorAll("input").forEach((inp, i) => (kidDraft[i].nick = inp.value));
  $("kList").querySelectorAll("select").forEach((sel, i) => (kidDraft[i].g = Number(sel.value)));
}
function paintKids() {
  $("kList").innerHTML = kidDraft.map((k, i) => `<li><input class="sub-input" value="${esc(k.nick)}" maxlength="10" placeholder="닉네임 (예: 시운)" aria-label="${i + 1}번째 자녀 닉네임" />
    <select class="grade-pick" aria-label="${i + 1}번째 자녀 학년"><option value="-1"${k.g < 0 ? " selected" : ""}>학년</option>${GRADES.map((g, j) => `<option value="${j}"${k.g === j ? " selected" : ""}>${g}</option>`).join("")}</select>
    ${kidDraft.length > 1 ? `<button type="button" class="x" data-rm="${i}" aria-label="${esc(k.nick || "이 자녀")} 지우기">✕</button>` : ""}</li>`).join("");
}
$("kList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rm]"); if (!b) return;
  syncKids(); kidDraft.splice(Number(b.dataset.rm), 1); paintKids();
});
$("kList").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("kSave").click(); } });
$("kAdd").addEventListener("click", () => {
  syncKids(); kidDraft.push({ id: uid(), nick: "", g: -1 }); paintKids();
  const ins = $("kList").querySelectorAll("input"); ins[ins.length - 1].focus();
});
$("kidsDialog").addEventListener("cancel", (e) => { if (kidsFirst) e.preventDefault(); });
$("kSave").addEventListener("click", () => {
  syncKids();
  const nicks = kidDraft.map((k) => k.nick.trim());
  if (nicks.some((n) => !n)) { toast("닉네임을 모두 적어 주세요"); return; }
  if (new Set(nicks).size !== nicks.length) { toast("같은 닉네임이 있어요"); return; }
  if (kidDraft.some((k) => k.g < 0)) { toast("학년을 모두 골라 주세요"); return; }
  saveRecords(); saveJournal();
  const keep = new Set(kidDraft.map((k) => k.id));
  const removed = kids.filter((k) => !keep.has(k.id));
  if (removed.length) {
    const gone = new Set(removed.map((k) => k.id));
    const n = allRecords.filter((r) => gone.has(r.kid)).length + allJournal.filter((j) => gone.has(j.kid)).length;
    if (n && !confirm(`${removed.map((k) => k.nick).join(", ")}의 기록 ${n}개도 함께 지워져요. 되돌릴 수 없어요.\n지울까요? (먼저 설정 → 내 기록 내려받기로 저장해 둘 수 있어요)`)) return;
    allRecords = allRecords.filter((r) => !gone.has(r.kid));
    allJournal = allJournal.filter((j) => !gone.has(j.kid));
  }
  const sy = schoolYear();
  kids = kidDraft.map((k) => ({ id: k.id, nick: k.nick.trim(), grade: k.g, gradeYear: sy }));
  // 자녀 등록 전에 만든 기록은 첫째 자녀에게
  for (const x of [...allRecords, ...allJournal]) if (!x.kid) x.kid = kids[0].id;
  writeAll();
  if (!kids.some((k) => k.id === activeKid)) activeKid = kids[0].id;
  $("kidsDialog").close("saved");
  setKid(activeKid);
  toast(kidsFirst ? `${kids.map((k) => k.nick).join(", ")} 등록 완료! 🎉` : "자녀 정보를 저장했어요");
});

// ---------- 카테고리 편집 ----------
// 새 카테고리 아이콘: 책·영어·듣기는 이미 있으니 자주 쓰는 것만
const PICK_ALL = [["pencil", "메모"], ["math-symbols", "수학"], ["star", "별"], ["music", "음악"], ["ball-football", "축구"], ["heart", "좋은 일"], ["plant", "식물"]];
let catDraft = [], newKind = "time", newIcon = "star", pickFor = "new"; // pickFor: "new" 또는 목록 번호
const catColor = (c) => CAT_COLOR[c.key] || "#2F5D3A";
const LOCKED = (c) => c.kind === "book" || c.kind === "focus" || c.key === "secret";
const KIND_NAME = { book: "책장", focus: "책장+시간", time: "한 것+시간", note: "메모" };
$("cEmoji").innerHTML = PICK_ALL.map(([n, label]) => `<button type="button" data-e="${n}" aria-label="${label} 아이콘 고르기">${ico(n)}</button>`).join("");
function paintPick() {
  const cur = pickFor === "new" ? newIcon : catDraft[pickFor]?.icon;
  $("cPickFor").textContent = pickFor === "new" ? "새 카테고리 아이콘 고르기" : `‘${catDraft[pickFor]?.name || ""}’ 아이콘 고르기`;
  [...$("cEmoji").children].forEach((b) => b.classList.toggle("on", b.dataset.e === cur));
  $("cNewIcon").innerHTML = ico(newIcon);
  $("cNewIcon").classList.toggle("on", pickFor === "new");
}
$("cEmoji").addEventListener("click", (e) => {
  const b = e.target.closest("[data-e]"); if (!b) return;
  if (pickFor === "new") newIcon = b.dataset.e;
  else { syncCats(); catDraft[pickFor].icon = b.dataset.e; paintCats(); }
  paintPick();
});
$("cNewIcon").addEventListener("click", () => { pickFor = "new"; paintCats(); paintPick(); });
$("cNewKind").addEventListener("click", (e) => {
  const b = e.target.closest("[data-kind]"); if (!b) return;
  newKind = b.dataset.kind;
  [...$("cNewKind").children].forEach((x) => x.setAttribute("aria-checked", String(x === b)));
});
function openCats() {
  catDraft = catList.map((c) => ({ ...c, icon: toIcon(c.icon) }));
  newIcon = "star"; pickFor = "new"; $("cNewName").value = "";
  paintCats(); paintPick();
  $("catsDialog").showModal();
}
function syncCats() {
  $("cList").querySelectorAll("li").forEach((li, i) => {
    catDraft[i].name = li.querySelector(".nm-in").value;
  });
}
function paintCats() {
  const last = catDraft.length - 1;
  $("cList").innerHTML = catDraft.map((c, i) => `<li data-i="${i}" class="${c.hidden ? "off" : ""}" title="${KIND_NAME[c.kind] || ""}">
    <button type="button" class="ic-btn${pickFor === i ? " on" : ""}" data-ic aria-label="${esc(c.name)} 아이콘 바꾸기">${ico(c.icon, "", catColor(c))}</button>
    <input class="nm-in" value="${esc(c.name)}" maxlength="8" aria-label="카테고리 이름" />
    <button type="button" data-mv="-1" aria-label="위로" ${i ? "" : "disabled"}>▲</button>
    <button type="button" data-mv="1" aria-label="아래로" ${i < last ? "" : "disabled"}>▼</button>
    <button type="button" data-hide aria-label="${c.hidden ? "보이기" : "숨기기"}">${ico(c.hidden ? "eye-off" : "eye")}</button>
    ${LOCKED(c) ? `<span class="lock" title="${c.key === "secret" ? "비밀 메모는 지울 수 없고 숨기기만 돼요" : "책장과 연결돼 있어서 숨기기만 돼요"}">${ico("lock")}</span>` : `<button type="button" data-rm aria-label="${esc(c.name)} 삭제">${ico("trash")}</button>`}
  </li>`).join("");
}
$("cList").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  syncCats();
  const i = Number(b.closest("li").dataset.i);
  if (b.hasAttribute("data-ic")) { pickFor = i; paintCats(); paintPick(); return; }
  if (b.dataset.mv) { const j = i + Number(b.dataset.mv); [catDraft[i], catDraft[j]] = [catDraft[j], catDraft[i]]; if (pickFor === i) pickFor = j; else if (pickFor === j) pickFor = i; }
  else if (b.hasAttribute("data-hide")) catDraft[i].hidden = !catDraft[i].hidden;
  else if (b.hasAttribute("data-rm")) { catDraft.splice(i, 1); pickFor = "new"; }
  paintCats(); paintPick();
});
$("cAdd").addEventListener("click", () => {
  syncCats();
  const name = $("cNewName").value.trim();
  if (!name) { toast("새 카테고리 이름을 적어 주세요"); $("cNewName").focus(); return; }
  if (catDraft.some((c) => c.name === name)) { toast("같은 이름이 있어요"); return; }
  catDraft.push({ key: "c_" + uid().replace(/-/g, "").slice(0, 10), icon: newIcon, name, kind: newKind });
  newIcon = "star"; pickFor = "new"; $("cNewName").value = "";
  paintCats(); paintPick();
  toast(`‘${name}’을(를) 추가했어요. 저장을 눌러 주세요`);
});
$("cSave").addEventListener("click", () => {
  syncCats();
  if (catDraft.some((c) => !c.name.trim())) { toast("이름이 빈 카테고리가 있어요"); return; }
  const keep = new Set(catDraft.map((c) => c.key));
  const removed = catList.filter((c) => !keep.has(c.key));
  if (removed.length) {
    saveJournal();
    const gone = new Set(removed.map((c) => c.key));
    const n = allJournal.filter((j) => gone.has(j.cat)).length;
    if (n && !confirm(`${removed.map((c) => c.name).join(", ")} 카테고리를 지우면 기록 ${n}개(모든 자녀)도 함께 지워져요. 되돌릴 수 없어요.\n지울까요?`)) return;
    allJournal = allJournal.filter((j) => !gone.has(j.cat));
    writeAll(); viewJournal();
  }
  catList = catDraft.map((c) => ({ ...c, name: c.name.trim() }));
  saveCats(); refreshCats();
  $("catsDialog").close("saved");
  render();
  toast("카테고리를 저장했어요");
});

// ---------- 설정 ----------
const EXPORT_KEY = "kbc:lastExport";
function openSettings() {
  const last = store.getItem(EXPORT_KEY);
  $("lastExport").textContent = last ? `마지막으로 내려받은 날: ${last}` : "모든 자녀의 기록을 파일 하나(ZIP)로 저장해요";
  $("acctEmail").textContent = sync.currentEmail() ? `${sync.currentEmail()} 로 로그인했어요${AUTH.offline ? " (지금은 인터넷 없음)" : ""}` : "";
  $("setPrivate").checked = !sync.getPublic();
  $("setNickTxt").textContent = sync.myNick() ? `${sync.myNick()} · 게시판에 이 이름으로 보여요` : "게시판에서 쓸 이름을 정해 주세요";
  $("setAdmin").hidden = !sync.amAdmin();
  $("settingsDialog").showModal();
}
$("setPrivate").addEventListener("change", async (e) => {
  const priv = e.target.checked;
  try { await sync.setPublic(!priv); toast(priv ? "이제 나만 볼 수 있어요 🔒" : "이제 다른 사람도 구경할 수 있어요 👀"); }
  catch { e.target.checked = !priv; toast("바꾸지 못했어요. 인터넷 연결을 확인해 주세요"); }
});
$("setLogout").addEventListener("click", async () => {
  if (!confirm("로그아웃할까요?\n기록은 계정에 남아 있어서 다시 로그인하면 그대로 보여요.")) return;
  try { await sync.signOut(); location.replace(location.pathname); }
  catch (err) { toast(err.message === "unsynced" ? "아직 계정에 올라가지 않은 기록이 있어요. 인터넷에 연결한 뒤 다시 해 주세요" : "로그아웃하지 못했어요. 인터넷 연결을 확인해 주세요", 4000); }
});

// ---------- 둘러보기 (공개한 다른 집 책장) ----------
let browseLoaded = false;
const peekCache = new Map(); // 친구 기록을 미리 받아 두기 → 누르면 바로 보임
function prefetchPeek(u) {
  if (!peekCache.has(u)) peekCache.set(u, sync.fetchUser(u).catch(() => { peekCache.delete(u); return null; }));
  return peekCache.get(u);
}
// 엄마 얼굴 (안 고른 사람은 별명 첫 글자)
function avatar(nick, face, cls = "av") {
  if (validFace(face)) return `<span class="${cls}">${faceSvg(face)}</span>`;
  const n = String(nick || "?");
  const i = [...n].reduce((a, ch) => a + ch.codePointAt(0), 0) % FACE_COLORS.length;
  return `<span class="${cls} av-txt" style="background:${FACE_COLORS[i]}">${esc([...n][0].toUpperCase())}</span>`;
}
const agoDay = (iso) => {
  const n = dayDiff(localDay(new Date(iso)), localDay());
  return n <= 0 ? "오늘 기록" : n === 1 ? "어제 기록" : n < 30 ? `${n}일 전 기록` : "한 달 넘게 쉬는 중";
};
const momRow = (m, nbMark = true) => `<li><button type="button" class="mom-tile" data-u="${esc(m.user_id)}">${avatar(m.nick, m.face)}<b>${esc(m.nick)}</b>${m.tag ? `<small>${esc(m.tag)}</small>` : m.updated_at ? `<small>${agoDay(m.updated_at).replace(" 기록", "")}</small>` : ""}${nbMark && follows.has(m.user_id) ? `<em>이웃</em>` : ""}</button></li>`;
let follows = new Map(), followsLoaded = false, momOffset = 0;
async function renderBrowse() {
  $("browseWrap").hidden = !!(PEEK || !AUTH.user || AUTH.offline);
  if ($("browseWrap").hidden) return;
  if (browseLoaded) return;
  browseLoaded = true;
  $("nbList").innerHTML = `<li class="muted">불러오는 중…</li>`;
  try {
    const nb = await sync.myFollows();
    follows = new Map(nb.map((m) => [m.user_id, m])); followsLoaded = true;
    nb.forEach((m) => momCache.set(m.user_id, { ...momCache.get(m.user_id), ...m }));
    paintFollows();
    nb.slice(0, 6).forEach((m) => prefetchPeek(m.user_id));
  } catch {
    browseLoaded = false;
    $("nbList").innerHTML = `<li class="muted">불러오지 못했어요. 인터넷 연결을 확인해 주세요.</li>`;
  }
}
function paintFollows() {
  $("nbList").innerHTML = [...follows.values()].map((m) => momRow({ ...m, updated_at: null }, false)).join("")
    || `<li class="muted">아직 이웃이 없어요. 위의 학년이나 같은 책으로 친구를 찾아 이웃으로 추가해 보세요.</li>`;
}

// ---------- 친구 찾기 칩: 학년 · 같은 책 읽은 친구 ----------
let momGrade = -1, momMode = "", momOffset2 = 0;
function closeMomRes() {
  momMode = ""; momGrade = -1;
  $("momRes").hidden = true; $("gradePick").hidden = true;
  $("chipGrade").setAttribute("aria-expanded", "false"); $("chipGrade").classList.remove("on"); $("chipGradeTx").textContent = "";
  $("chipSame").setAttribute("aria-pressed", "false");
}
function showMomRes(title) {
  $("momRes").hidden = false; $("momResTitle").textContent = title;
  $("momResList").innerHTML = `<li class="muted">찾는 중…</li>`; $("momResMore").hidden = true;
}
$("chipGrade").addEventListener("click", () => {
  const open = $("gradePick").hidden;
  $("gradePick").hidden = !open; $("chipGrade").setAttribute("aria-expanded", String(open));
  if (!open) return;
  const mine = new Set(kids.map(gradeIdx).filter((i) => i >= 0));
  $("gradePick").innerHTML = GRADES.slice(0, -1).map((g, i) => `<button type="button" data-g="${i}" class="${mine.has(i) ? "mine" : ""}${i === momGrade ? " on" : ""}">${g}</button>`).join("")
    + (mine.size ? `<small>● 우리 아이 학년</small>` : "");
});
$("gradePick").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-g]"); if (!b) return;
  const g = Number(b.dataset.g);
  closeMomRes();
  momMode = "grade"; momGrade = g; momOffset2 = 0;
  $("chipGrade").classList.add("on"); $("chipGradeTx").textContent = ` · ${GRADES[g]}`;
  showMomRes(`🎒 ${GRADES[g]} 아이가 있는 집`);
  try { addRes(await sync.momsByGrade(g, schoolYear(), 0), g); } catch { $("momResList").innerHTML = `<li class="muted">불러오지 못했어요. 인터넷 연결을 확인해 주세요.</li>`; }
});
function addRes({ list, more }, g) {
  if (momMode !== "grade" || g !== momGrade) return;
  if (!momOffset2) $("momResList").innerHTML = "";
  momOffset2 += 20;
  list.forEach((m) => momCache.set(m.user_id, m));
  $("momResList").insertAdjacentHTML("beforeend", list.map((m) => momRow({ ...m, updated_at: null })).join("")); // 최근에 기록한 집이 먼저 (날짜 표시는 안 함)
  if (!$("momResList").children.length) $("momResList").innerHTML = `<li class="muted">아직 ${GRADES[g]} 아이가 있는 공개 책장이 없어요.</li>`;
  $("momResMore").hidden = !more;
}
$("momResMore").addEventListener("click", async () => {
  $("momResMore").disabled = true;
  try { addRes(await sync.momsByGrade(momGrade, schoolYear(), momOffset2), momGrade); } catch { toast("불러오지 못했어요. 인터넷 연결을 확인해 주세요"); }
  $("momResMore").disabled = false;
});
$("chipSame").addEventListener("click", async () => {
  if (momMode === "same") { closeMomRes(); return; }
  closeMomRes();
  momMode = "same"; $("chipSame").setAttribute("aria-pressed", "true");
  const k = kidNow();
  showMomRes(`📚 ${k ? k.nick + " 책장과" : "우리 책장과"} 같은 책을 읽은 친구`);
  const isbns = [...new Set(records.map((r) => r.isbn).filter((i) => i && /^\d{10,13}$/.test(i)))].slice(0, 500);
  if (!isbns.length) { $("momResList").innerHTML = `<li class="muted">책을 먼저 기록하면 같은 책을 읽은 친구를 찾아 드려요.</li>`; return; }
  try {
    const list = await sync.momsSameBooks(isbns);
    if (momMode !== "same") return;
    list.forEach((m) => momCache.set(m.user_id, m));
    $("momResList").innerHTML = list.map((m) => momRow({ ...m, tag: `같은 책 ${m.n}권` })).join("") || `<li class="muted">아직 같은 책을 읽은 공개 책장이 없어요.</li>`;
  } catch { $("momResList").innerHTML = `<li class="muted">불러오지 못했어요. 인터넷 연결을 확인해 주세요.</li>`; }
});
$("momResClose").addEventListener("click", closeMomRes);
let momQT = 0;
$("momQ").addEventListener("input", () => {
  clearTimeout(momQT);
  const q = $("momQ").value.trim();
  $("momMain").hidden = !!q; $("momFound").hidden = !q;
  if (!q) return;
  $("momFound").innerHTML = `<li class="muted">찾는 중…</li>`;
  momQT = setTimeout(async () => {
    try {
      const list = await sync.searchMoms(q);
      if ($("momQ").value.trim() !== q) return;
      list.forEach((m) => momCache.set(m.user_id, m));
      $("momFound").innerHTML = list.length ? list.map(momRow).join("") : `<li class="muted">"${esc(q)}" 별명을 찾지 못했어요</li>`;
    } catch { $("momFound").innerHTML = `<li class="muted">찾지 못했어요. 인터넷 연결을 확인해 주세요.</li>`; }
  }, 350);
});
for (const id of ["momResList", "momFound", "nbList"]) {
  $(id).addEventListener("pointerdown", (e) => { const b = e.target.closest("[data-u]"); if (b) prefetchPeek(b.dataset.u); });
  $(id).addEventListener("click", (e) => { const b = e.target.closest("[data-u]"); if (b) openMom(b.dataset.u); });
}
// 앱을 다시 열지 않고 화면만 친구 책장으로 바꾸기 (구경하는 동안은 휴대폰에 아무것도 저장하지 않음)
function enterPeek(data, kid, uid = null) {
  PEEK_UID = uid;
  fillMem(data, kid);
  PEEK = data; store = memStore;
  loadState();
  document.body.classList.add("peek"); $("peekBar").hidden = false;
  renderKids(); render(); go("home");
}
function exitPeek() {
  if (PARAMS.get("peek")) { location.href = "/#stats"; return; } // 주소로 들어온 구경은 다시 열기
  PEEK = null; PEEK_UID = null; store = localStore; mem.clear();
  loadState();
  document.body.classList.remove("peek"); $("peekBar").hidden = true;
  renderKids(); render(); go("stats");
}
$("peekBack").addEventListener("click", exitPeek);
$("gearBtn").addEventListener("click", openSettings);
$("setKids").addEventListener("click", () => { $("settingsDialog").close("away"); openKids(false); });
$("setCats").addEventListener("click", () => { $("settingsDialog").close("away"); openCats(); });
$("setExport").addEventListener("click", () => { exportAll(); });
$("setImport").addEventListener("click", () => $("importFile").click());

// ---------- 내 기록 내려받기 / 다시 올리기 ----------
const BACKUP_FORMAT = "banana-bookcode-backup", BACKUP_VERSION = 1;
const ABOUT = {
  "이 파일은": "바나나북코드(아이 독서기록 앱)의 모든 기록을 담은 보관용 파일이에요. 앱의 '설정 → 기록 파일 다시 올리기'로 복원할 수 있어요.",
  kids: "자녀 목록. id, nick(닉네임), grade(학년 번호: 0=3세 … 4=7세, 5=초1 … 10=초6, 11=중1 … 13=중3, 14=고1 … 16=고3, 17=졸업), gradeYear(그 학년이었던 학년도, 3월 시작). 지금 학년 = grade + (올해 학년도 - gradeYear)",
  categories: "포트폴리오 카테고리. kind: book=책장(한글책/영어책), focus=집중듣기(책+시간), time=한 것+시간, note=메모. hidden=숨김",
  records: "책 기록(책 한 권 = 1개). kid=자녀 id, shelf: ko 한글책 / en 영어책 / focus 집중듣기. sessions=읽은 날(day, YYYY-MM-DD)마다 읽은 쪽(from~to)과 집중듣기 시간(minutes, 분), round=몇 번째 읽기였는지(없으면 1). round=지금 몇 번째 읽는 중인지, finishes=끝까지 읽은 회차와 날짜 목록(읽은 횟수), totalPages=전체 쪽수, done=지금 회차를 끝까지 읽음, score=별점(1~5), note=독후활동 글, bonusRounds=독후활동 포인트(+50)를 받은 회차, category=분야",
  journal: "포트폴리오 하루 기록. kid=자녀 id, day=날짜, cat=카테고리 key, what=한 것, minutes=시간(분), text=메모(일기), photos=사진 보관함 경로 목록(사진 파일은 이 백업에 들어 있지 않고 계정 보관함에 있어요)",
  "포인트 규칙": "읽은 쪽수 1쪽 = 1점, 독후활동을 쓰면 +50점. 스탬프는 끝까지 읽은 책 1권에 1개, 8개가 한 판",
};
const plainDay = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일 (${"일월화수목금토"[new Date(y, m - 1, d).getDay()]})`;
};
function backupData() {
  saveRecords(); saveJournal();
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, app: "바나나북코드", site: location.origin, exportedAt: new Date().toISOString(),
    about: ABOUT, kids, categories: catList, records: allRecords, journal: allJournal };
}
function diaryHtml(d) {
  const catOf = Object.fromEntries(d.categories.map((c) => [c.key, c]));
  const shelfLabel = { ko: "📕 한글책", en: "📘 영어책", focus: "👂 집중듣기" };
  const list = d.kids.length ? d.kids : [{ id: undefined, nick: "기록" }];
  const body = list.map((k) => {
    const recs = d.records.filter((r) => r.kid === k.id || (!r.kid && k === list[0]));
    const jr = d.journal.filter((j) => j.kid === k.id || (!j.kid && k === list[0]));
    const days = {};
    const add = (day, html) => (days[day] ||= []).push(html);
    for (const r of recs) for (const s of r.sessions) add(s.day, `<li>${shelfLabel[shelfOf(r)] || "📚"} <b>${esc(r.title)}</b> · ${esc(sessionText(s))}</li>`);
    for (const j of jr) {
      const c = catOf[j.cat] || { icon: "", name: j.cat };
      add(j.day, `<li>${ICON_EMOJI[toIcon(c.icon)] || "•"} ${esc(c.name)}${j.what ? ` · <b>${esc(j.what)}</b>` : ""}${j.minutes ? ` · ${fmtMin(j.minutes)}` : ""}${plainText(j.text) ? `<div class="memo">${esc(plainText(j.text))}</div>` : ""}${j.photos?.length ? `<div class="memo">📷 사진 ${j.photos.length}장 (앱에서 볼 수 있어요)</div>` : ""}</li>`);
    }
    const rr = recs.filter((r) => shelfOf(r) !== "focus"), foMin = recs.reduce((a, r) => a + (shelfOf(r) === "focus" ? minsOf(r) : 0), 0) + jr.filter((j) => j.cat === "focus").reduce((a, j) => a + (j.minutes || 0), 0);
    const pages = rr.reduce((a, r) => a + pagesOf(r), 0), pts = rr.reduce((a, r) => a + pointsOf(r), 0);
    return `<section><h2>🍌 ${esc(k.nick)}${gradeOf(k) ? " " + gradeOf(k) : ""}</h2>
      <p class="sum">책 ${rr.length}권 · 끝까지 읽은 횟수 ${rr.reduce((a, r) => a + (r.finishes || []).length, 0)}번 · ${pages.toLocaleString()}쪽 · 독서 포인트 ${pts.toLocaleString()}점${foMin ? ` · 집중듣기 ${fmtMin(foMin)}` : ""}</p>
      <h3>📅 날짜별 기록</h3>
      ${Object.keys(days).sort().reverse().map((day) => `<div class="day"><h4>${plainDay(day)}</h4><ul>${days[day].join("")}</ul></div>`).join("") || "<p>기록이 없어요</p>"}
      <h3>📚 읽은 책</h3>
      ${recs.length ? `<table><thead><tr><th>책</th><th>책장 · 분야</th><th>읽은 쪽</th><th>별점</th><th>내 생각</th></tr></thead><tbody>
      ${recs.map((r) => `<tr><td>${r.cover ? `<img src="${esc(r.cover)}" alt="">` : ""}<b>${esc(r.title)}</b><br><small>${esc(r.authors || "")}</small></td>
        <td>${shelfLabel[shelfOf(r)] || ""}${r.category ? `<br><small>${esc(r.category)}</small>` : ""}</td>
        <td>${readTo(r)}${r.totalPages ? ` / ${r.totalPages}` : ""}쪽${r.done ? " ✅" : ""}${minsOf(r) ? `<br>${isFo(r) ? "🎧" : "⏱"} ${fmtMin(minsOf(r))}` : ""}</td>
        <td>${r.score ? "★".repeat(r.score) : ""}</td><td class="memo">${esc(r.note || "")}</td></tr>`).join("")}</tbody></table>` : "<p>아직 읽은 책이 없어요</p>"}
    </section>`;
  }).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>바나나북코드 기록장</title><style>
body{font-family:-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;max-width:820px;margin:0 auto;padding:24px 18px;color:#15161A;line-height:1.6}
h1{margin:0}.sub{color:#7C7F8A;margin:4px 0 24px}section{margin-bottom:40px;page-break-after:always}
h2{border-bottom:3px solid #CFF53A;padding-bottom:4px}.sum{background:#F4F5F8;border-radius:12px;padding:10px 14px}
.day{break-inside:avoid;margin-bottom:12px}h4{margin:14px 0 4px;color:#3E7CB1}ul{margin:0;padding-left:20px}
.memo{white-space:pre-line;color:#3A3C44}table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border-bottom:1px solid #E7E8EE;padding:8px 6px;text-align:left;vertical-align:top}
td img{width:42px;float:left;margin-right:8px;border-radius:4px}tr{break-inside:avoid}
</style></head><body><h1>🍌 바나나북코드 기록장</h1>
<p class="sub">${new Date(d.exportedAt).toLocaleString("ko-KR")}에 내려받음 · 브라우저에서 인쇄하면 PDF로도 저장할 수 있어요</p>${body}</body></html>`;
}

// ZIP 만들기/읽기 (외부 라이브러리 없이)
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  const t = new Date(), dosT = (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1);
  const dosD = ((t.getFullYear() - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate();
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint16(10, dosT, true); h.setUint16(12, dosD, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(12, dosT, true); c.setUint16(14, dosD, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(c.buffer, name);
    off += 30 + name.length + data.length;
  }
  const size = central.reduce((a, p) => a + p.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: "application/zip" });
}
async function readZipJson(buf) {
  const v = new DataView(buf), dec = new TextDecoder();
  let e = buf.byteLength - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("not zip");
  const n = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  for (let i = 0; i < n; i++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nl));
    p += 46 + nl + xl + cl;
    if (!/\.json$/i.test(name) || name.includes("__MACOSX")) continue;
    const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
    let bytes = new Uint8Array(buf, start, size);
    if (method === 8) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    else if (method !== 0) throw new Error("zip method");
    return JSON.parse(dec.decode(bytes));
  }
  throw new Error("no json");
}
async function saveFile(blob, name) {
  // 홈 화면 앱(PWA)으로 열었을 때는 공유 창으로 저장 (아이폰에서 다운로드가 막히는 경우 대비)
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const file = new File([blob], name, { type: blob.type });
  if (standalone && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}
async function exportAll() {
  const d = backupData();
  const json = JSON.stringify(d, null, 2);
  const readme = `바나나북코드 기록 파일 (${localDay()})\r\n\r\n` +
    `1. 바나나북코드-백업.json : 모든 기록이 들어 있는 보관용 파일이에요.\r\n   앱의 설정 → '기록 파일 다시 올리기'에서 이 ZIP 파일이나 JSON 파일을 올리면 복원돼요.\r\n   AI(Claude, ChatGPT 등)에게 보여 주면 내용을 정리하거나 다른 형식으로 바꿀 수 있어요.\r\n\r\n` +
    `2. 바나나북코드-기록장.html : 날짜별 일기처럼 읽을 수 있는 기록장이에요.\r\n   브라우저로 열어서 인쇄하면 PDF로 저장할 수 있어요.\r\n`;
  const blob = makeZip([
    { name: "바나나북코드-백업.json", data: json },
    { name: "바나나북코드-기록장.html", data: diaryHtml(d) },
    { name: "읽어주세요.txt", data: readme },
  ]);
  await saveFile(blob, `바나나북코드-기록-${localDay()}.zip`);
  store.setItem(EXPORT_KEY, localDay());
  $("lastExport").textContent = `마지막으로 내려받은 날: ${localDay()}`;
  toast("💾 기록 파일을 내려받았어요");
}
function mergeBackup(d) {
  saveRecords(); saveJournal();
  const kidMap = {}, n = { k: 0, c: 0, r: 0, s: 0, j: 0 };
  for (const k of d.kids || []) {
    const same = kids.find((x) => x.id === k.id) || kids.find((x) => x.nick === k.nick);
    if (same) kidMap[k.id] = same.id;
    else { kids.push({ id: k.id || uid(), nick: k.nick || "자녀", ...(k.grade != null && k.gradeYear != null ? { grade: k.grade, gradeYear: k.gradeYear } : {}) }); kidMap[k.id] = kids.at(-1).id; n.k++; }
    if (same && same.grade == null && k.grade != null && k.gradeYear != null) { same.grade = k.grade; same.gradeYear = k.gradeYear; }
  }
  if (!kids.length) kids.push({ id: uid(), nick: "자녀" });
  const fallback = activeKid && kids.some((k) => k.id === activeKid) ? activeKid : kids[0].id;
  const kidOf = (id) => { const m = kidMap[id] || id; return kids.some((k) => k.id === m) ? m : fallback; };
  for (const c of d.categories || []) {
    if (c?.key && !catList.some((x) => x.key === c.key)) { catList.push({ key: c.key, icon: toIcon(c.icon), name: c.name || "카테고리", kind: c.kind || "time", hidden: !!c.hidden }); n.c++; }
  }
  for (const r0 of d.records || []) {
    if (!r0?.title) continue;
    const r = migrate({ ...r0, sessions: (r0.sessions || []).map((s) => ({ ...s })) });
    r.kid = kidOf(r0.kid); r.id = r.id || uid();
    const same = allRecords.find((x) => x.id === r.id) || (r.isbn && allRecords.find((x) => x.kid === r.kid && x.isbn === r.isbn && isFo(x) === isFo(r)));
    if (!same) { allRecords.push(r); n.r++; n.s += r.sessions.length; continue; }
    const key = (s) => `${s.day}|${s.from}|${s.to}|${s.round || 1}`;
    const have = new Set(same.sessions.map(key));
    for (const s of r.sessions) if (!have.has(key(s))) { same.sessions.push(s); n.s++; }
    for (const f of ["score", "note", "category", "totalPages", "cover", "description", "authors", "publisher"]) if (!same[f] && r[f]) same[f] = r[f];
    if (r.bonus) same.bonus = true;
    same.bonusRounds = [...new Set([...(same.bonusRounds || []), ...(r.bonusRounds || [])])];
    for (const f of r.finishes || []) if (!(same.finishes || []).some((x) => x.round === f.round)) same.finishes = [...(same.finishes || []), f];
    same.round = Math.max(roundOf(same), roundOf(r));
    if (r.done && !same.done && roundOf(r) === roundOf(same)) { same.done = true; same.doneAt = r.doneAt || Date.now(); }
  }
  for (const j of d.journal || []) {
    if (!j?.day || allJournal.some((x) => x.id === j.id)) continue;
    allJournal.push({ ...j, id: j.id || uid(), kid: kidOf(j.kid) }); n.j++;
  }
  writeAll(); saveCats(); refreshCats();
  activeKid = fallback; saveKids();
  setKid(activeKid);
  return n;
}
$("importFile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  let d;
  try {
    const buf = await f.arrayBuffer();
    const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(8, buf.byteLength))).replace(/^\s+/, "").trim();
    d = head.startsWith("{") ? JSON.parse(new TextDecoder().decode(buf).replace(/^\s+/, "")) : await readZipJson(buf);
    if (d?.format !== BACKUP_FORMAT) throw new Error("format");
  } catch {
    toast("바나나북코드 기록 파일이 아니거나 읽을 수 없어요", 3500); return;
  }
  if ((d.version || 1) > BACKUP_VERSION && !confirm("더 새로운 앱에서 만든 파일이에요. 일부 내용이 빠질 수 있어요. 그래도 올릴까요?")) return;
  if (!confirm(`이 파일에는 자녀 ${d.kids?.length || 0}명, 책 ${d.records?.length || 0}권, 하루 기록 ${d.journal?.length || 0}개가 있어요.\n지금 기록에 합칠까요? (이미 있는 기록은 한 번만 들어가요)`)) return;
  $("settingsDialog").close();
  const n = mergeBackup(d);
  toast(`가져왔어요! 자녀 ${n.k}명 · 책 ${n.r}권 · 읽은 기록 ${n.s}개 · 하루 기록 ${n.j}개`, 4500);
});

// ---------- 시작 ----------
renderKids();
render();
go(["port", "stats", "board", "blog"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "home");
warmUpDetector();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
// 지금 store(내 기록 또는 구경 중인 친구 기록)에서 화면 상태를 다시 읽기
function loadState() {
  kids = readJSON(KIDS_KEY, []);
  activeKid = store.getItem(ACTIVE_KEY);
  if (!kids.some((k) => k.id === activeKid)) activeKid = kids[0]?.id || null;
  allRecords = readJSON(REC_KEY, []).map(migrate); viewRecords();
  allJournal = readJSON(JOURNAL_KEY, []); viewJournal();
  const cl = readJSON(CATS_KEY, null);
  catList = (Array.isArray(cl) ? cl : [...DEFAULT_CATS]).map((c) => ({ ...c, icon: toIcon(c.icon) }));
  refreshCats();
  $("monthFilter").value = "all";
}

// 화면에 고정된 아이콘 채우기 (탭, 설정, 책 스캔, 책장 제목)
document.querySelectorAll("[data-ico]").forEach((el) => { el.innerHTML = ico(el.dataset.ico); });

// ---------- 엄마 별명 ----------
let nickFirst = false, nFace = { f: 0, c: 0 };
function paintFacePick() {
  $("nFaceNow").innerHTML = faceSvg(nFace);
  $("nFaces").innerHTML = Array.from({ length: FACE_COUNT }, (_, i) => `<button type="button" class="${i === nFace.f ? "on" : ""}" data-f="${i}" aria-label="표정 ${i + 1}">${faceSvg({ f: i, c: nFace.c })}</button>`).join("");
  $("nCols").innerHTML = FACE_COLORS.map((x, i) => `<button type="button" class="${i === nFace.c ? "on" : ""}" data-c="${i}" style="background:${x}" aria-label="색 ${i + 1}"></button>`).join("");
}
$("nFaces").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (b) { nFace.f = Number(b.dataset.f); paintFacePick(); } });
$("nCols").addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (b) { nFace.c = Number(b.dataset.c); paintFacePick(); } });
function openNick(first = false) {
  nickFirst = first;
  $("nTitle").textContent = first ? "엄마 별명을 정해 주세요" : "엄마 별명 바꾸기";
  $("nIn").value = sync.myNick(); $("nErr").textContent = "";
  nFace = validFace(sync.myFace()) ? { ...sync.myFace() } : { f: 0, c: 0 };
  paintFacePick();
  $("nCancel").hidden = first;
  $("nickDialog").showModal();
  setTimeout(() => $("nIn").focus(), 50);
}
$("nickDialog").addEventListener("cancel", (e) => { if (nickFirst) e.preventDefault(); });
$("nIn").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("nSave").click(); } });
$("nSave").addEventListener("click", async () => {
  const v = $("nIn").value.trim();
  if (!/^[0-9A-Za-z가-힣_]{2,12}$/.test(v)) { $("nErr").textContent = "한글·영어·숫자로 2~12자, 띄어쓰기 없이 적어 주세요"; return; }
  $("nSave").disabled = true; $("nErr").textContent = "";
  try {
    await sync.setNick(v, { f: nFace.f, c: nFace.c });
    $("nickDialog").close("saved");
    toast(`반가워요, ${v}님!`);
    if (nickFirst && !kids.length) openKids(true);
    boardLoaded = "";
    if (!$("postView").open && document.querySelector('.tab[data-tab="board"]:not([hidden])')) renderBoard();
  } catch (err) {
    $("nErr").textContent = err.message === "taken" ? "다른 분이 쓰고 있는 별명이에요. 다른 별명을 골라 주세요" : "저장하지 못했어요. 인터넷 연결을 확인해 주세요";
  }
  $("nSave").disabled = false;
});
$("setNick").addEventListener("click", () => { $("settingsDialog").close("away"); openNick(false); });

// ---------- 게시판 ----------
const BOARDS = { free: "자유", books: "책 추천", qna: "질문" };
let board = "free", boardLoaded = "", postNow = null;
const viewed = new Set(); // 이번에 앱을 켜고 조회수를 올린 글
const ago = (iso) => {
  const d = new Date(iso), now = new Date();
  if (localDay(d) === localDay(now)) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
};
async function renderBoard(force = false) {
  [...$("boardPick").children].forEach((x) => x.setAttribute("aria-checked", String(x.dataset.b === board)));
  if (!AUTH.user || AUTH.offline) { $("postList").innerHTML = `<li class="muted">게시판은 인터넷에 연결돼 있을 때 볼 수 있어요.</li>`; return; }
  if (!force && boardLoaded === board) return;
  boardLoaded = board;
  $("postList").innerHTML = `<li class="muted">불러오는 중…</li>`;
  try {
    const list = await sync.listPosts(board);
    if (boardLoaded !== board) return;
    $("postList").innerHTML = list.length ? list.map((p) => `<li><button type="button" class="post-row${p.pinned ? " pinned" : ""}" data-id="${p.id}">
        <b>${p.pinned ? `<span class="pin">공지</span>` : ""}${esc(p.title)}</b>
        <small><span class="who">${avatar(p.nick, p.face, "av xs")}${esc(p.nick)}</span><span>${ago(p.created_at)}</span>${p.views ? `<span>${ico("eye")} ${p.views}</span>` : ""}${p.nComments ? `<span>${ico("message")} ${p.nComments}</span>` : ""}${p.nLikes ? `<span>${ico("heart")} ${p.nLikes}</span>` : ""}</small>
      </button></li>`).join("") : `<li class="muted">아직 글이 없어요. 첫 글을 써 보세요!</li>`;
  } catch {
    boardLoaded = "";
    $("postList").innerHTML = `<li class="muted">불러오지 못했어요. 인터넷 연결을 확인해 주세요.</li>`;
  }
}
$("boardPick").addEventListener("click", (e) => { const b = e.target.closest("[data-b]"); if (b) { board = b.dataset.b; renderBoard(); } });
$("postList").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) openPost(b.dataset.id); });

async function openPost(id) {
  if (!$("postView").open) $("postView").showModal();
  $("pTitle").textContent = "불러오는 중…"; $("pMeta").textContent = ""; $("pBody").textContent = "";
  $("pComments").innerHTML = ""; $("pActions").innerHTML = ""; $("pLike").hidden = true; $("pBoard").textContent = "";
  try {
    const p = await sync.getPost(id);
    if (!p) { $("postView").close(); toast("지워진 글이에요"); renderBoard(true); return; }
    postNow = p;
    paintPost();
    if (!viewed.has(id)) {
      viewed.add(id);
      sync.bumpView(id).then((n) => { if (n != null && postNow?.id === id && n !== postNow.views) { postNow.views = n; paintMeta(); boardLoaded = ""; } }).catch(() => viewed.delete(id));
    }
  } catch { $("pTitle").textContent = "불러오지 못했어요. 인터넷 연결을 확인해 주세요."; }
}
function paintMeta() {
  const p = postNow;
  $("pMeta").innerHTML = `<button type="button" class="nick-link" data-u="${esc(p.user_id)}">${avatar(p.nick, p.face, "av xs")}${esc(p.nick)}</button> · ${ago(p.created_at)}${p.updated_at && Date.parse(p.updated_at) - Date.parse(p.created_at) > 60000 ? " · 고침" : ""} · 조회 ${p.views || 0}`;
}
function paintPost() {
  const p = postNow, mine = p.user_id === sync.myId(), adm = sync.amAdmin();
  $("pBoard").textContent = `${BOARDS[p.board] || ""}${p.pinned ? " · 공지" : ""}`;
  $("pTitle").textContent = p.title;
  paintMeta();
  $("pTopic").innerHTML = p.topic?.title ? topicCardHtml(p.topic) : "";
  fillTopicImgs($("pTopic"));
  $("pBody").innerHTML = richHtml(p.body, p.photos || [], "ph-row inl"); // 사진은 글 사이에 (예전 글은 맨 아래)
  fillPhotoRows($("pBody"));
  $("pLike").hidden = false;
  $("pLike").classList.toggle("on", p.liked);
  $("pLike").innerHTML = `${ico("heart")} 좋아요 ${p.nLikes || ""}`;
  $("pActions").innerHTML = [
    adm ? actBtn("pin", "pin", p.pinned ? "공지 풀기" : "공지로 고정", p.pinned) : "",
    mine ? actBtn("edit", "pencil", "고치기") : "",
    mine || adm ? actBtn("del", "trash", "지우기") : "",
    !mine && !adm && sync.myId() ? actBtn("report", "flag", "신고") : "",
  ].join("");
  $("pCnt").textContent = p.comments.length || "";
  $("pComments").innerHTML = cmtTree(p.comments, (c) => c.user_id === sync.myId() || adm, !adm);
  setReTo("p", null);
}
// 댓글 + 답글 (한 단계) — 답글의 답글도 같은 댓글 아래에 붙어요
function cmtTree(list, canDel, canReport = true) {
  const ids = new Set(list.map((c) => c.id));
  const top = list.filter((c) => !c.parent_id || !ids.has(c.parent_id));
  const row = (c, root) => `<li${root !== c.id ? ` class="re"` : ""}><div>${root !== c.id ? `<span class="re-mark">↳</span>` : ""}<b>${esc(c.nick)}</b><small>${ago(c.created_at)}</small>
      ${sync.myId() ? `<button type="button" class="re-btn" data-r="${root}" data-n="${esc(c.nick)}">답글</button>` : ""}${canDel(c) ? `<button type="button" class="x" data-c="${c.id}" aria-label="댓글 지우기">✕</button>` : canReport && sync.myId() ? `<button type="button" class="rp-btn" data-rp="${c.id}">신고</button>` : ""}</div><p>${esc(c.body)}</p></li>`;
  return top.map((c) => row(c, c.id) + list.filter((r) => r.parent_id === c.id).map((r) => row(r, c.id)).join("")).join("")
    || `<li class="muted">첫 댓글을 남겨 보세요</li>`;
}
const reTo = {}; // { p: { id, nick }, bv: … }
function setReTo(k, x) {
  reTo[k] = x;
  const el = $(k + "ReTo");
  el.hidden = !x;
  el.innerHTML = x ? `<span>↳ <b>${esc(x.nick)}</b> 님에게 답글</span><button type="button" data-cancel>취소</button>` : "";
  $(k + "CIn").placeholder = x ? "답글을 적어 주세요" : "댓글을 적어 주세요";
  if (x) $(k + "CIn").focus();
}
for (const k of ["p", "bv"]) $(k + "ReTo").addEventListener("click", (e) => { if (e.target.closest("[data-cancel]")) setReTo(k, null); });
$("pClose").addEventListener("click", () => $("postView").close());
$("postView").addEventListener("close", () => { if (!boardLoaded) renderBoard(); }); // 댓글·좋아요 수 새로 고침
$("pLike").addEventListener("click", async () => {
  const p = postNow; if (!p) return;
  const on = !p.liked;
  p.liked = on; p.nLikes = Math.max(0, (p.nLikes || 0) + (on ? 1 : -1)); paintPost();
  try { await sync.toggleLike(p.id, on); boardLoaded = ""; }
  catch { p.liked = !on; p.nLikes += on ? -1 : 1; paintPost(); toast("인터넷 연결을 확인해 주세요"); }
});
$("pActions").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-a]"); const p = postNow; if (!b || !p) return;
  if (b.dataset.a === "report") { reportIt("post", p.id); return; }
  if (b.dataset.a === "edit") { $("postView").close(); openWrite(p); return; }
  if (b.dataset.a === "del") {
    if (!confirm("이 글을 지울까요? 댓글도 함께 지워져요. 되돌릴 수 없어요.")) return;
    try { await sync.deletePost(p); $("postView").close(); toast("글을 지웠어요"); renderBoard(true); }
    catch { toast("지우지 못했어요. 인터넷 연결을 확인해 주세요"); }
    return;
  }
  if (b.dataset.a === "pin") {
    try { await sync.setPinned(p.id, !p.pinned); p.pinned = !p.pinned; paintPost(); boardLoaded = ""; toast(p.pinned ? "공지로 고정했어요" : "공지를 풀었어요"); }
    catch { toast("바꾸지 못했어요"); }
  }
});
$("pComments").addEventListener("click", async (e) => {
  const rp = e.target.closest("[data-rp]"); if (rp) { reportIt("comment", rp.dataset.rp); return; }
  const r = e.target.closest("[data-r]"); if (r) { setReTo("p", { id: r.dataset.r, nick: r.dataset.n }); return; }
  const b = e.target.closest("[data-c]"); if (!b || !postNow) return;
  if (!confirm("이 댓글을 지울까요?")) return;
  try { await sync.deleteComment(b.dataset.c); boardLoaded = ""; openPost(postNow.id); }
  catch { toast("지우지 못했어요"); }
});
$("pCSend").addEventListener("click", async () => {
  const v = $("pCIn").value.trim(); if (!v || !postNow) return;
  if (!sync.myNick()) { openNick(false); return; }
  $("pCSend").disabled = true;
  try { await sync.addComment(postNow.id, v, reTo.p?.id || null); $("pCIn").value = ""; boardLoaded = ""; await openPost(postNow.id); }
  catch (e) { toast(sync.isBanErr(e) ? BAN_MSG : "댓글을 올리지 못했어요. 인터넷 연결을 확인해 주세요", 3500); }
  $("pCSend").disabled = false;
});

// 글 위 아이콘 버튼 (공지·고치기·지우기·신고): 마우스를 올리면 설명이 떠요
function actBtn(a, icon, label, on = false) { return `<button type="button" class="act-ic${on ? " on" : ""}" data-a="${a}" title="${label}" aria-label="${label}">${ico(icon)}</button>`; }
// 글쓰기 · 고치기 — 사진은 글 쓰던 자리에 들어가요 (블로그처럼)
let writing = null;
const pRich = makeRich($("peRich"), { placeholder: "내용을 적어 주세요", max: MAX_PHOTOS, onChange: (gone) => { if (gone?.file) URL.revokeObjectURL(gone.url); paintWPhotos(); } });
function paintWPhotos() {
  const n = pRich.photos().length;
  $("pePhotoCount").textContent = `사진 ${n}/${MAX_PHOTOS}`;
  $("pePhotoAdd").disabled = n >= MAX_PHOTOS;
}
function openWrite(p = null) {
  if (!AUTH.user || AUTH.offline) { toast("게시판은 인터넷에 연결돼 있을 때 쓸 수 있어요"); return; }
  if (!sync.myNick()) { openNick(false); return; }
  writing = p;
  pRich.photos().forEach((x) => x.file && URL.revokeObjectURL(x.url));
  const items = (p?.photos || []).map((path) => ({ path, url: "" }));
  // 예전 글(사진이 맨 아래에 따로 있던 글)은 고칠 때 사진 자리를 글 끝에 붙여 줌
  let body = p?.body || "";
  const marks = body.split("\n").filter((l) => l.trim() === MARK).length;
  if (items.length > marks) body = [body.trim(), ...Array(items.length - marks).fill(MARK)].filter(Boolean).join("\n");
  pRich.set(body, items);
  if (p?.photos?.length) sync.photoUrls(p.photos).then((urls) => { const m = new Map(p.photos.map((pa, i) => [pa, urls[i]])); items.forEach((x) => { if (x.path) x.url = m.get(x.path) || ""; }); pRich.refresh(); });
  const bd = p?.board || board;
  [...$("peBoard").children].forEach((x) => x.setAttribute("aria-checked", String(x.dataset.b === bd)));
  $("peTitle").value = p?.title || "";
  $("peSave").textContent = p ? "고치기" : "올리기";
  paintWPhotos();
  if (wTopic?.url) URL.revokeObjectURL(wTopic.url);
  topicTo = "peTopic"; wTopic = p?.topic?.title ? { ...p.topic } : null;
  paintWTopic();
  $("postEdit").showModal();
}
$("bWrite").addEventListener("click", () => openWrite());
$("peBoard").addEventListener("click", (e) => { const b = e.target.closest("[data-b]"); if (b) [...$("peBoard").children].forEach((x) => x.setAttribute("aria-checked", String(x === b))); });
$("peClose").addEventListener("click", () => {
  if (($("peTitle").value.trim() || pRich.get().body) && !writing && !confirm("쓰던 글을 버릴까요?")) return;
  $("postEdit").close();
});
for (const ev of ["mousedown", "pointerdown"]) $("pePhotoAdd").addEventListener(ev, (e) => e.preventDefault()); // 글 쓰던 자리를 놓치지 않게
$("pePhotoAdd").addEventListener("click", () => $("pePhotoFile").click());
$("pePhotoFile").addEventListener("change", () => {
  const files = pickImages($("pePhotoFile"));
  const room = MAX_PHOTOS - pRich.photos().length;
  if (files.length > room) toast(`사진은 ${MAX_PHOTOS}장까지 넣을 수 있어요`);
  pRich.insert(files.slice(0, room).map((f) => ({ file: f, url: URL.createObjectURL(f) })));
  $("pePhotoFile").value = "";
  paintWPhotos();
});
$("peSave").addEventListener("click", async () => {
  const title = $("peTitle").value.trim(), rich = pRich.get();
  const bd = [...$("peBoard").children].find((x) => x.getAttribute("aria-checked") === "true")?.dataset.b || "free";
  if (!title) { toast("제목을 적어 주세요"); $("peTitle").focus(); return; }
  if (rich.text.length > 5000) { toast("내용은 5,000자까지 쓸 수 있어요"); return; }
  $("peSave").disabled = true;
  try {
    const kept = rich.items.filter((x) => x.path).map((x) => x.path);
    const fresh = rich.items.filter((x) => x.file);
    const up = await uploadRich(rich, "board");
    const body = up.body, paths = up.paths;
    if (up.failed) toast(`사진 ${up.failed}장은 올리지 못했어요`, 3000);
    const removed = (writing?.photos || []).filter((x) => !kept.includes(x));
    let topic = null;
    if (wTopic) {
      topic = { type: tType(wTopic), title: wTopic.title };
      for (const k of ["cover", "by", "photo"]) if (wTopic[k]) topic[k] = wTopic[k];
      if (wTopic.file) { try { topic.photo = await sync.uploadPhoto(await shrinkPhoto(wTopic.file), "board"); } catch { /* 사진 없이 */ } }
    }
    const oldTp = writing?.topic?.photo;
    if (oldTp && oldTp !== topic?.photo) removed.push(oldTp);
    const id = await sync.savePost({ id: writing?.id, board: bd, title, body, photos: paths, topic });
    if (wTopic?.url) URL.revokeObjectURL(wTopic.url);
    wTopic = null;
    if (removed.length) sync.deletePhotos(removed);
    fresh.forEach((x) => URL.revokeObjectURL(x.url)); pRich.clear();
    $("postEdit").close();
    toast(writing ? "글을 고쳤어요" : "글을 올렸어요");
    board = bd; boardLoaded = ""; renderBoard(true);
    openPost(id);
  } catch (e) { toast(sync.isBanErr(e) ? BAN_MSG : "올리지 못했어요. 인터넷 연결을 확인해 주세요", 3500); }
  $("peSave").disabled = false;
});

// ---------- 글감 ----------
const TOPIC = { book: ["책", "book"], movie: ["영화", "movie"], show: ["공연·전시", "ticket"], tv: ["방송", "device-tv"] };
const tType = (t) => (TOPIC[t?.type] ? t.type : "book");
function topicCover(t, cls) {
  if (t.url) return `<img class="${cls}" src="${esc(t.url)}" alt="">`;
  if (t.cover) return `<img class="${cls}" src="${esc(t.cover)}" alt="" loading="lazy">`;
  if (t.photo) return `<img class="${cls}" data-tp="${esc(t.photo)}" alt="">`;
  return `<span class="${cls} tp-ph t-${tType(t)}">${ico(TOPIC[tType(t)][1])}</span>`;
}
const topicCardHtml = (t) => `<div class="topic-card">${topicCover(t, "tc-cover")}<div><small>${TOPIC[tType(t)][0]}</small><b>${esc(t.title)}</b>${t.by ? `<small>${esc(t.by)}</small>` : ""}</div></div>`;
async function fillTopicImgs(root) {
  const els = [...root.querySelectorAll("img[data-tp]")]; if (!els.length) return;
  const urls = await sync.photoUrls(els.map((e) => e.dataset.tp));
  els.forEach((e, i) => { if (urls[i]) e.src = urls[i]; });
}
// 글쓰기 화면의 글감
let wTopic = null, topicTo = "peTopic"; // 글감을 그릴 곳 (게시판 글쓰기 / 블로그 글쓰기) // { type, title, cover?, by?, photo?(저장된 사진), file?, url?(새 사진 미리보기) }
function paintWTopic() {
  $(topicTo).innerHTML = wTopic
    ? `<div class="topic-pick">${topicCardHtml(wTopic)}<button type="button" class="x" id="peTopicRm" aria-label="글감 빼기">✕</button></div>`
    : topicTo === "beTopic" ? "" : `<button type="button" class="btn ghost topic-add" id="peTopicAdd">＋ 글감 붙이기</button>`;
  fillTopicImgs($(topicTo));
}
$("peTopic").addEventListener("click", (e) => {
  if (e.target.closest("#peTopicRm")) { if (wTopic?.url) URL.revokeObjectURL(wTopic.url); wTopic = null; paintWTopic(); return; }
  if (e.target.closest("#peTopicAdd") || e.target.closest(".topic-card")) openTopicPick();
});
let tdType = "book", tdFile = null, tdItems = [];
function openTopicPick() {
  tdType = wTopic ? tType(wTopic) : "book"; tdFile = null;
  $("tdTitle").value = wTopic && tdType !== "book" ? wTopic.title : "";
  $("tdQ").value = "";
  paintTd();
  $("topicDialog").showModal();
}
function paintTd() {
  [...$("tdType").children].forEach((x) => x.setAttribute("aria-checked", String(x.dataset.t === tdType)));
  $("tdBook").hidden = tdType !== "book"; $("tdOther").hidden = tdType === "book";
  if (tdType === "book") myBooks(); else paintTdCover();
}
function myBooks() {
  const q = $("tdQ").value.trim().toLowerCase();
  const seen = new Set();
  tdItems = allRecords.filter((r) => r.title && (!q || r.title.toLowerCase().includes(q)) && !seen.has(r.title) && seen.add(r.title))
    .slice(0, 40).map((r) => ({ title: r.title, cover: r.cover || "", by: r.authors || "" }));
  $("tdHelp").textContent = "내 책장에 있는 책이에요. 없으면 제목을 적고 찾기를 눌러요.";
  paintTdList();
}
function paintTdList() {
  $("tdList").innerHTML = tdItems.length ? tdItems.map((b, i) => `<button type="button" class="find-item" data-i="${i}">
      ${b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy">` : `<span class="noimg"></span>`}
      <span><b>${esc(b.title)}</b><small>${esc(b.by)}</small></span></button>`).join("")
    : `<small class="muted">${$("tdQ").value.trim() ? "내 책장에 없는 책이에요. 찾기를 눌러 보세요." : "아직 책장에 책이 없어요. 제목을 적고 찾기를 눌러요."}</small>`;
}
$("tdType").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { tdType = b.dataset.t; paintTd(); } });
$("tdQ").addEventListener("input", myBooks);
$("tdQ").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("tdFind").click(); } });
$("tdFind").addEventListener("click", async () => {
  const q = $("tdQ").value.trim();
  if (q.length < 2) { toast("책 제목을 2글자 이상 적어 주세요"); return; }
  $("tdList").innerHTML = `<small class="muted">찾는 중…</small>`;
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const found = r.ok ? (await r.json()).results || [] : [];
    tdItems = found.map((b) => ({ title: b.title, cover: b.cover || "", by: (b.authors || []).join(", ") }));
    $("tdHelp").textContent = "찾은 책이에요. 맞는 책을 골라 주세요.";
    if (!tdItems.length) tdItems = [{ title: q, cover: "", by: "" }];
    paintTdList();
  } catch { $("tdList").innerHTML = `<small class="muted">찾지 못했어요. 인터넷 연결을 확인해 주세요.</small>`; }
});
$("tdList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-i]"); if (!b) return;
  const it = tdItems[Number(b.dataset.i)];
  if (wTopic?.url) URL.revokeObjectURL(wTopic.url);
  wTopic = { type: "book", title: it.title, ...(it.cover ? { cover: it.cover } : {}), ...(it.by ? { by: it.by } : {}) };
  $("topicDialog").close(); paintWTopic();
});
function paintTdCover() {
  const keep = !tdFile && wTopic && tType(wTopic) === tdType && (wTopic.url || wTopic.photo);
  const t = tdFile ? { type: tdType, url: $("tdCover").dataset.url } : keep ? wTopic : { type: tdType };
  $("tdCover").innerHTML = topicCover(t, "tc-cover big");
  fillTopicImgs($("tdCover"));
}
$("tdPhotoBtn").addEventListener("click", () => $("tdPhoto").click());
$("tdPhoto").addEventListener("change", () => {
  const f = $("tdPhoto").files[0]; $("tdPhoto").value = "";
  if (!f) return;
  if ($("tdCover").dataset.url) URL.revokeObjectURL($("tdCover").dataset.url);
  tdFile = f; $("tdCover").dataset.url = URL.createObjectURL(f);
  paintTdCover();
});
$("tdUse").addEventListener("click", () => {
  const title = $("tdTitle").value.trim();
  if (!title) { toast("제목을 적어 주세요"); $("tdTitle").focus(); return; }
  const same = wTopic && tType(wTopic) === tdType;
  const next = { type: tdType, title };
  if (tdFile) { next.file = tdFile; next.url = $("tdCover").dataset.url; delete $("tdCover").dataset.url; }
  else if (same && wTopic.url) { next.file = wTopic.file; next.url = wTopic.url; }
  else if (same && wTopic.photo) next.photo = wTopic.photo;
  if (wTopic?.url && wTopic.url !== next.url) URL.revokeObjectURL(wTopic.url);
  wTopic = next; tdFile = null;
  $("topicDialog").close(); paintWTopic();
});
$("tdClose").addEventListener("click", () => { $("topicDialog").close(); if (tdFile && $("tdCover").dataset.url) { URL.revokeObjectURL($("tdCover").dataset.url); delete $("tdCover").dataset.url; } tdFile = null; });

// ---------- 홈: 인기글 ----------
let popAt = 0;
async function renderPopular(force = false) {
  if (PEEK || !AUTH.user || AUTH.offline) { $("popWrap").hidden = true; return; }
  if (!force && Date.now() - popAt < 120000) return;
  popAt = Date.now();
  try {
    const list = await sync.listPopular();
    $("popWrap").hidden = !list.length;
    if (!list.length) return;
    const paths = [...new Set(list.map((p) => p.photos?.[0] || "").filter(Boolean))];
    const urls = paths.length ? await sync.photoUrls(paths) : [];
    const u = new Map(paths.map((p, i) => [p, urls[i]]));
    $("popRow").innerHTML = list.map((p) => {
      const ph = p.photos?.[0] ? u.get(p.photos[0]) : "";
      const img = ph ? `<img src="${esc(ph)}" alt="" loading="lazy">` : p.topic?.title ? topicCover(p.topic, "pop-img") : "";
      return `<button type="button" class="pop-card" data-id="${p.id}">
        ${img ? `<span class="pop-im">${img}</span>` : ""}
        <b>${esc(p.title)}</b>
        ${img ? "" : `<p>${esc(plainText(p.body || "").replace(/\s+/g, " ").slice(0, 70))}</p>`}
        <small>${avatar(p.nick, p.face, "av xs")}${esc(p.nick)} · 조회 ${p.views || 0}</small></button>`;
    }).join("");
    fillTopicImgs($("popRow"));
  } catch { popAt = 0; $("popWrap").hidden = true; }
}
$("popRow").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) openPost(b.dataset.id); });
$("popMore").addEventListener("click", () => go("board"));
$("postView").addEventListener("close", () => {
  if (!document.querySelector('.tab[data-tab="home"]').hidden) renderPopular(true); else popAt = 0;
});

// ---------- 엄마 블로그 (내 블로그 탭 + 남의 블로그) ----------
let momNow = null, myBlog = null;
const momCache = new Map();
const blogThumb = (b, cls) => b.photos?.length ? `<img class="${cls}" data-tp="${esc(b.photos[0])}" alt="">` : b.topic?.title ? topicCover(b.topic, cls) : `<span class="${cls} tp-ph t-none">${ico("notebook")}</span>`;
function blogTopics(st) {
  const g = new Map();
  for (const p of st?.list || []) {
    if (!p.topic?.title) continue;
    const key = `${tType(p.topic)}|${p.topic.title.trim().toLowerCase()}`;
    if (!g.has(key)) g.set(key, { key, topic: p.topic, posts: [] });
    g.get(key).posts.push(p);
  }
  return [...g.values()];
}
function blogTags(st) {
  const m = new Map();
  for (const p of st?.list || []) for (const t of p.tags || []) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ t, n }));
}
async function loadBlog(uid) {
  const me = uid === sync.myId(), known = momCache.get(uid);
  const [prof, data, list] = await Promise.all([
    me ? { nick: sync.myNick(), face: sync.myFace(), blog_cats: sync.myBlogCats() } : sync.profileOf(uid).catch(() => known?.nick ? known : null),
    me ? null : prefetchPeek(uid),
    sync.blogList(uid),
  ]);
  return { uid, me, nick: prof?.nick || "(알 수 없음)", face: prof?.face || null, cats: Array.isArray(prof?.blog_cats) ? prof.blog_cats : [], data, list, view: "list", cat: "" };
}
// 블로그 카테고리: 글의 cat 이 목록에 없으면(지운 카테고리) 미분류
const NOCAT = "_none";
const catOf = (st, b) => (b.cat && st.cats.some((c) => c.id === b.cat) ? b.cat : NOCAT);
function catChips(st) {
  const cnt = new Map();
  for (const b of st.list) { const k = catOf(st, b); cnt.set(k, (cnt.get(k) || 0) + 1); }
  const chip = (id, name, n) => `<button type="button" data-act="cat" data-c="${esc(id)}" class="${st.cat === id ? "on" : ""}">${esc(name)} <small>${n}</small></button>`;
  const rows = [chip("", "전체", st.list.length), ...st.cats.map((c) => chip(c.id, c.name, cnt.get(c.id) || 0))];
  if (cnt.get(NOCAT) && st.cats.length) rows.push(chip(NOCAT, "미분류", cnt.get(NOCAT)));
  return rows.join("");
}
function paintBlog(root, st) {
  if (!st) { root.innerHTML = `<p class="muted bl-msg">불러오는 중…</p>`; return; }
  const tops = blogTops(st), tags = blogTags(st);
  const n = (t) => tops.filter((x) => tType(x.topic) === t).length;
  const pop = [...st.list].filter((b) => b.views > 0).sort((a, b) => b.views - a.views).slice(0, 6);
  const kl = st.me ? [] : st.data?.kids || [];
  const nb = follows.has(st.uid);
  if (st.cat && st.cat !== NOCAT && !st.cats.some((c) => c.id === st.cat)) st.cat = "";
  const shown = st.cat ? st.list.filter((b) => catOf(st, b) === st.cat) : st.list;
  root.innerHTML = `<div class="bl-wrap"><aside class="bl-side">
    <div class="bl-head">${avatar(st.nick, st.face, "av big")}<div class="grow"><h2>${esc(st.nick)}님의 블로그</h2><p>글 ${st.list.length}</p></div>
      ${st.me ? `<button type="button" class="follow-btn" data-act="write">✏️ 글쓰기</button>` : `<button type="button" class="follow-btn${nb ? " on" : ""}" data-act="follow">${nb ? "이웃 ✓" : "＋ 이웃 추가"}</button>`}</div>
    <section class="gb-sec">${gbPreview(st)}</section>
    ${st.me ? "" : `<section><h3 class="sec-title">아이 책장</h3><div class="browse">${kl.length
      ? kl.map((k) => `<button type="button" class="kid" data-act="kid" data-k="${esc(k.id)}">${esc(k.nick)}${gradeOf(k) ? ` <small class="grade">${gradeOf(k)}</small>` : ""}</button>`).join("")
      : `<small class="muted">${st.data ? "아직 등록한 아이가 없어요." : "책장을 나만 보기로 해 둔 집이에요."}</small>`}</div></section>`}
    ${st.cats.length || st.me ? `<section><div class="pop-head"><h3 class="sec-title">카테고리</h3>${st.me ? `<button type="button" class="link-btn" data-act="cats">${ico("pencil")} 편집</button>` : ""}</div>
      ${st.cats.length ? `<div class="bl-cats">${catChips(st)}</div>` : `<p class="muted bl-msg sm">카테고리를 만들어 글을 나눠 보세요. 예: 그림책 · 영어 원서 · 도서관 나들이</p>`}</section>` : ""}
    ${tops.length && !st.cat ? `<section><div class="pop-head"><h3 class="sec-title">글감</h3><button type="button" class="link-btn" data-act="topics" data-t="all">전체보기 ›</button></div>
      <div class="tchips">${Object.keys(TOPIC).filter(n).map((t) => `<button type="button" class="tchip" data-act="topics" data-t="${t}">${ico(TOPIC[t][1])}${TOPIC[t][0]} <span>${n(t)}</span></button>`).join("")}</div></section>` : ""}
    ${tags.length && !st.cat ? `<section><h3 class="sec-title">태그</h3><div class="bl-tags">${tags.slice(0, 20).map((x) => `<button type="button" data-act="tag" data-tag="${esc(x.t)}">#${esc(x.t)} <small>${x.n}</small></button>`).join("")}</div></section>` : ""}
    </aside><div class="bl-main">
    ${pop.length && !st.cat ? `<section><h3 class="sec-title">인기글</h3><div class="pop-row">${pop.map((b) => `<button type="button" class="pop-card" data-act="post" data-id="${b.id}">
        <span class="pop-im">${blogThumb(b, "pop-img")}</span><b>${esc(b.title)}</b><small>조회 ${b.views}</small></button>`).join("")}</div></section>` : ""}
    <section><div class="pop-head"><h3 class="sec-title">${st.cat ? esc(st.cat === NOCAT ? "미분류" : st.cats.find((c) => c.id === st.cat)?.name || "전체글") : "전체글"}${st.cat ? ` <small class="muted">${shown.length}</small>` : ""}</h3>${st.list.length ? `<span class="bl-view"><button type="button" data-act="view" data-v="list" class="${st.view === "list" ? "on" : ""}">목록</button><button type="button" data-act="view" data-v="grid" class="${st.view === "grid" ? "on" : ""}">사진</button></span>` : ""}</div>
      ${!shown.length ? `<p class="muted bl-msg">${st.me ? (st.cat ? "이 카테고리에는 아직 글이 없어요." : "아직 쓴 글이 없어요. 위의 글쓰기를 눌러 첫 글을 남겨 보세요!") : "아직 공개한 글이 없어요."}</p>`
      : st.view === "grid" ? `<div class="tp-grid">${shown.map((b) => `<button type="button" class="tp-item" data-act="post" data-id="${b.id}">${blogThumb(b, "tp-cover")}<span>${b.is_public ? "" : "🔒 "}${esc(b.title)}</span></button>`).join("")}</div>`
      : `<ul class="bl-list">${shown.map((b) => `<li><button type="button" class="bl-row" data-act="post" data-id="${b.id}">${blogThumb(b, "bl-th")}<span class="grow"><b>${esc(b.title)}</b><em class="bl-pv">${esc(plainText(b.body || "").replace(/\s+/g, " ").slice(0, 140))}</em>
          <small>${!st.cat && catOf(st, b) !== NOCAT ? `${esc(st.cats.find((c) => c.id === b.cat).name)} · ` : ""}${ago(b.created_at)}${b.tags?.length ? ` · #${esc(b.tags[0])}` : ""} · ${b.is_public ? `조회 ${b.views || 0}` : "🔒 나만 보기"}</small></span></button></li>`).join("")}</ul>`}
    </section></div></div>`;
  fillTopicImgs(root);
  if (!st.gb) loadGuest(st).then(() => { const s = root.querySelector(".gb-sec"); if (s) s.innerHTML = gbPreview(st); });
}
const blogTops = blogTopics;

// ---------- 방명록: 블로그 옆에 최근 글 2개 + 전체보기 ----------
async function loadGuest(st) {
  try { st.gb = await sync.guestbook(st.uid); } catch { st.gb = st.gb || null; }
  return st.gb;
}
function gbPreview(st) {
  const top = (st.gb || []).filter((g) => !g.parent_id);
  const head = `<div class="pop-head"><h3 class="sec-title">방명록 ${st.gb ? `<small class="muted">${top.length}</small>` : ""}</h3><button type="button" class="link-btn" data-act="guest">${st.me ? "전체보기 ›" : "✍️ 남기기"}</button></div>`;
  if (!st.gb) return head + `<p class="muted bl-msg sm">불러오는 중…</p>`;
  if (!top.length) return head + `<p class="muted bl-msg sm">${st.me ? "아직 방명록이 없어요. 이웃이 인사를 남기면 여기에 보여요." : "첫 인사를 남겨 보세요 😊"}</p>`;
  return head + `<ul class="gb-mini">${top.slice(0, 2).map((g) => `<li><button type="button" data-act="guest">${avatar(g.nick, g.face, "av sm")}<span><b>${esc(g.nick)}</b>${g.secret ? " 🔒" : ""}<em>${esc(g.body.length > 50 ? g.body.slice(0, 50) + "…" : g.body)}</em></span></button></li>`).join("")}</ul>`;
}
let gbNow = null, gbReply = null;
async function openGuest(st) {
  gbNow = st; gbReply = null;
  $("gbHead").textContent = st.me ? "내 방명록" : `${st.nick}님의 방명록`;
  $("gbForm").hidden = !!st.me; $("gbIn").value = ""; $("gbSecret").checked = false;
  paintGuest(); $("gbPage").showModal();
  await loadGuest(st); if (gbNow === st) paintGuest();
}
function paintGuest() {
  const st = gbNow; if (!st) return;
  if (!st.gb) { $("gbList").innerHTML = `<li class="muted">불러오는 중…</li>`; return; }
  const me = sync.myId(), all = st.gb, top = all.filter((g) => !g.parent_id);
  const row = (g, sub) => `<li class="gb-item${sub ? " sub" : ""}">
      <div class="gb-top">${avatar(g.nick, g.face, "av sm")}<b>${esc(g.nick)}</b>${g.secret ? `<span class="gb-lock">🔒 비밀글</span>` : ""}<small>${ago(g.created_at)}</small>
        <span class="gb-acts">${!sub && st.me ? `<button type="button" class="link-btn" data-g="reply" data-id="${g.id}">답글</button>` : ""}${g.user_id === me || st.me ? `<button type="button" class="icon-btn" data-g="del" data-id="${g.id}" aria-label="지우기" title="지우기">${ico("trash")}</button>` : `<button type="button" class="icon-btn" data-g="flag" data-id="${g.id}" aria-label="신고" title="신고">${ico("flag")}</button>`}</span></div>
      <p>${esc(g.body)}</p>
      ${gbReply === g.id ? `<div class="gb-rbox"><input id="gbRIn" maxlength="300" placeholder="답글을 남겨요" /><button type="button" class="pill-btn" data-g="send" data-id="${g.id}">남기기</button></div>` : ""}</li>`;
  $("gbList").innerHTML = top.length ? top.map((g) => row(g) + [...all].filter((x) => x.parent_id === g.id).reverse().map((x) => row(x, true)).join("")).join("")
    : `<li class="muted">${st.me ? "아직 방명록이 없어요" : "첫 인사를 남겨 보세요 😊"}</li>`;
  if (gbReply) setTimeout(() => $("gbRIn")?.focus(), 30);
}
$("gbClose").addEventListener("click", () => $("gbPage").close());
$("gbPage").addEventListener("close", () => { if (gbNow) for (const r of [$("myBlog"), $("momBlog")]) { const s = r.querySelector(".gb-sec"); if (s && (gbNow === myBlog || gbNow === momNow)) s.innerHTML = gbPreview(gbNow); } });
$("gbForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = $("gbIn").value.trim(); if (!body || !gbNow) return;
  if (!sync.myNick()) { toast("방명록을 남기려면 엄마 별명을 먼저 정해 주세요"); openNick(false); return; }
  $("gbSend").disabled = true;
  try { await sync.addGuest(gbNow.uid, body, $("gbSecret").checked); $("gbIn").value = ""; $("gbSecret").checked = false; await loadGuest(gbNow); paintGuest(); toast("방명록을 남겼어요"); }
  catch (err) { toast(/ban/i.test(String(err?.message)) ? BAN_MSG : "남기지 못했어요. 인터넷 연결을 확인해 주세요"); }
  $("gbSend").disabled = false;
});
$("gbList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-g]"); if (!b || !gbNow) return;
  const { g, id } = b.dataset;
  if (g === "reply") { gbReply = gbReply === id ? null : id; paintGuest(); }
  else if (g === "send") {
    const body = $("gbRIn").value.trim(); if (!body) return;
    b.disabled = true;
    try { await sync.addGuest(gbNow.uid, body, !!gbNow.gb.find((x) => x.id === id)?.secret, id); gbReply = null; await loadGuest(gbNow); paintGuest(); }
    catch { toast("남기지 못했어요. 인터넷 연결을 확인해 주세요"); b.disabled = false; }
  } else if (g === "del") {
    if (!confirm("이 방명록 글을 지울까요?")) return;
    try { await sync.deleteGuest(id); await loadGuest(gbNow); paintGuest(); } catch { toast("지우지 못했어요"); }
  } else if (g === "flag") reportIt("guest", id);
});

// ---------- 👏 책 응원: 다른 집 아이 책 기록에 응원 보내기 / 내 책에 받은 응원 보기 ----------
async function paintCheer(r) {
  const box = $("vCheer"), me = sync.myId();
  const owner = PEEK ? PEEK_UID : me;
  box.hidden = !me || AUTH.offline || !owner; if (box.hidden) return;
  box.innerHTML = `<small class="muted">응원을 불러오는 중…</small>`;
  let list;
  try { list = await sync.cheers(owner, r.id); } catch { box.innerHTML = `<small class="muted">응원은 인터넷에 연결돼 있을 때 볼 수 있어요</small>`; return; }
  if (viewing !== r) return;
  const msgs = list.filter((c) => c.body).slice(0, 5).map((c) => `<li><b>${esc(c.nick)}</b><span>${esc(c.body)}</span><small>${ago(c.created_at)}</small></li>`).join("");
  if (PEEK) {
    const mine = list.find((c) => c.user_id === me);
    box.innerHTML = `<div class="ch-head"><b>👏 응원 ${list.length}</b></div>` + (mine
      ? `<p class="ch-done">응원했어요 ✓${mine.body ? ` 「${esc(mine.body)}」` : ""} <button type="button" class="link-btn" data-c="undo" data-id="${mine.id}">취소</button></p>`
      : `<div class="ch-form"><input id="chIn" maxlength="100" placeholder="한 줄 응원 (안 써도 돼요) 예: 멋지다! 나도 읽어 볼래" /><button type="button" class="btn lime" data-c="send">👏 응원하기</button></div>`) +
      (msgs ? `<ul class="ch-list">${msgs}</ul>` : "");
  } else {
    box.innerHTML = `<div class="ch-head"><b>👏 받은 응원 ${list.length}</b></div>` + (list.length
      ? (msgs ? `<ul class="ch-list">${msgs}</ul>` : `<p class="muted ch-none">${list.map((c) => esc(c.nick)).slice(0, 5).join(", ")}님이 응원했어요</p>`)
      : `<p class="muted ch-none">아직 받은 응원이 없어요. 이웃이 책장을 구경하다 응원을 보낼 수 있어요.</p>`);
  }
}
$("vCheer").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-c]"); if (!b || !viewing || !PEEK || !PEEK_UID) return;
  const r = viewing;
  if (b.dataset.c === "send" && !sync.myNick()) { toast("응원하려면 엄마 별명을 먼저 정해 주세요"); openNick(false); return; }
  b.disabled = true;
  try {
    if (b.dataset.c === "send") { await sync.addCheer(PEEK_UID, r.kid, r.id, r.title, $("chIn").value.trim()); toast("👏 응원을 보냈어요!"); }
    else await sync.deleteCheer(b.dataset.id);
    paintCheer(r);
  } catch { toast("보내지 못했어요. 인터넷 연결을 확인해 주세요"); b.disabled = false; }
});
async function renderMyBlog(force = false) {
  const root = $("myBlog");
  if (!AUTH.user || AUTH.offline) { root.innerHTML = `<p class="muted bl-msg">블로그는 인터넷에 연결돼 있을 때 볼 수 있어요.</p>`; return; }
  if (!sync.myNick()) { root.innerHTML = `<p class="muted bl-msg">블로그를 쓰려면 엄마 별명을 먼저 정해 주세요.</p><button type="button" class="btn dark" data-act="nick">엄마 별명 정하기</button>`; return; }
  if (myBlog && !force) { paintBlog(root, myBlog); return; }
  if (!myBlog) paintBlog(root, null);
  try { const view = myBlog?.view; myBlog = await loadBlog(sync.myId()); if (view) myBlog.view = view; paintBlog(root, myBlog); }
  catch { root.innerHTML = `<p class="muted bl-msg">불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>`; }
}
async function openMom(uid) {
  if (!AUTH.user || AUTH.offline || !uid) return;
  if (uid === sync.myId()) { for (const id of ["topicsPage", "postView", "blogView", "momPage"]) if ($(id).open) $(id).close(); go("blog"); return; }
  momNow = { uid };
  paintBlog($("momBlog"), null);
  if (!$("momPage").open) $("momPage").showModal();
  if (!followsLoaded) sync.myFollows().then((nb) => { follows = new Map(nb.map((m) => [m.user_id, m])); followsLoaded = true; if (momNow?.list) paintBlog($("momBlog"), momNow); }).catch(() => {});
  try {
    const st = await loadBlog(uid);
    if (momNow?.uid !== uid) return;
    momNow = st; paintBlog($("momBlog"), st);
  } catch { if (momNow?.uid === uid) $("momBlog").innerHTML = `<p class="muted bl-msg">불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>`; }
}
$("mClose").addEventListener("click", () => { $("momPage").close(); momNow = null; });
async function blogAct(e, st, root) {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act;
  if (a === "nick") { openNick(false); return; }
  if (!st) return;
  if (a === "write") openBlogEdit(null);
  else if (a === "post") openBlogPost(b.dataset.id, st);
  else if (a === "view") { st.view = b.dataset.v; paintBlog(root, st); }
  else if (a === "cat") { st.cat = st.cat === b.dataset.c ? "" : b.dataset.c; paintBlog(root, st); }
  else if (a === "cats") openBcEdit();
  else if (a === "guest") openGuest(st);
  else if (a === "topics") openGrid(st, { mode: "topic", type: b.dataset.t });
  else if (a === "tag") openGrid(st, { mode: "tag", tag: b.dataset.tag });
  else if (a === "kid") {
    const { data } = st;
    for (const id of ["topicsPage", "postView", "blogView", "momPage"]) if ($(id).open) $(id).close();
    momNow = null;
    if (!data) { toast("지금은 볼 수 없는 책장이에요 (나만 보기로 바뀌었을 수 있어요)", 3500); return; }
    enterPeek(data, b.dataset.k, st.uid);
  } else if (a === "follow") {
    const { uid, nick, face } = st, on = !follows.has(uid);
    if (!on && !confirm(`${nick}님을 이웃에서 뺄까요?`)) return;
    b.disabled = true;
    try {
      await sync.setFollow(uid, on);
      if (on) follows = new Map([[uid, { user_id: uid, nick, face }], ...follows]); else follows.delete(uid);
      toast(on ? `${nick}님을 이웃으로 추가했어요` : "이웃에서 뺐어요");
      browseLoaded = false; if (!document.querySelector('.tab[data-tab="stats"]').hidden) renderBrowse();
    } catch { toast("바꾸지 못했어요. 인터넷 연결을 확인해 주세요"); }
    paintBlog(root, st);
  }
}
$("myBlog").addEventListener("click", (e) => blogAct(e, myBlog, $("myBlog")));

// ---------- 블로그 카테고리 편집 (추가 · 이름 바꾸기 · 순서 · 지우기) ----------
const MAX_BCATS = 20;
let bcDraft = [];
function paintBcEdit() {
  $("bcList").innerHTML = bcDraft.map((c, i) => `<li data-i="${i}"><input class="bc-name" maxlength="20" value="${esc(c.name)}" aria-label="카테고리 이름" />
    <button type="button" class="ic-sm" data-mv="-1" title="위로" aria-label="위로"${i ? "" : " disabled"}>${ico("chevron-up")}</button><button type="button" class="ic-sm" data-mv="1" title="아래로" aria-label="아래로"${i < bcDraft.length - 1 ? "" : " disabled"}>${ico("chevron-down")}</button><button type="button" class="ic-sm del" data-rm title="지우기" aria-label="지우기">${ico("trash")}</button></li>`).join("")
    || `<li class="muted bc-empty">아직 카테고리가 없어요</li>`;
  $("bcCnt").textContent = `${bcDraft.length}/${MAX_BCATS}`;
  $("bcAddRow").hidden = bcDraft.length >= MAX_BCATS;
}
function openBcEdit() {
  bcDraft = sync.myBlogCats().map((c) => ({ ...c }));
  $("bcNew").value = "";
  paintBcEdit();
  $("bcEdit").showModal();
}
const bcSync = () => [...$("bcList").querySelectorAll("li[data-i]")].forEach((li) => { bcDraft[Number(li.dataset.i)].name = li.querySelector("input").value; });
function bcAdd() {
  const name = $("bcNew").value.trim().slice(0, 20); if (!name) { $("bcNew").focus(); return; }
  bcSync();
  if (bcDraft.some((c) => c.name.trim() === name)) { toast("같은 이름의 카테고리가 있어요"); return; }
  bcDraft.push({ id: Math.random().toString(36).slice(2, 10), name });
  $("bcNew").value = ""; paintBcEdit(); $("bcNew").focus();
}
$("bcAdd").addEventListener("click", bcAdd);
$("bcNew").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); bcAdd(); } });
$("bcList").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-i]"), b = e.target.closest("button"); if (!li || !b) return;
  bcSync();
  const i = Number(li.dataset.i);
  if (b.dataset.mv) { const j = i + Number(b.dataset.mv); [bcDraft[i], bcDraft[j]] = [bcDraft[j], bcDraft[i]]; }
  else if (b.hasAttribute("data-rm")) {
    const n = (myBlog?.list || []).filter((x) => x.cat === bcDraft[i].id).length;
    if (n && !confirm(`"${bcDraft[i].name}" 카테고리를 지울까요?\n안에 있는 글 ${n}개는 지워지지 않고 미분류로 옮겨져요.`)) return;
    bcDraft.splice(i, 1);
  }
  paintBcEdit();
});
$("bcClose").addEventListener("click", () => $("bcEdit").close());
$("bcSave").addEventListener("click", async () => {
  bcSync();
  const list = bcDraft.map((c) => ({ id: c.id, name: c.name.trim().slice(0, 20) })).filter((c) => c.name);
  if (new Set(list.map((c) => c.name)).size !== list.length) { toast("같은 이름의 카테고리가 있어요"); return; }
  $("bcSave").disabled = true;
  try {
    await sync.setBlogCats(list);
    if (myBlog) { myBlog.cats = list; paintBlog($("myBlog"), myBlog); }
    $("bcEdit").close(); toast("카테고리를 저장했어요");
  } catch { toast("저장하지 못했어요. 인터넷 연결을 확인해 주세요"); }
  $("bcSave").disabled = false;
});
$("momBlog").addEventListener("click", (e) => blogAct(e, momNow, $("momBlog")));
$("pMeta").addEventListener("click", (e) => { const b = e.target.closest("[data-u]"); if (b) openMom(b.dataset.u); });

// 글감·태그 모아보기 (사진 격자)
let grid = null; // { st, mode, type, tag, open }
function openGrid(st, opt) { grid = { st, mode: opt.mode, type: opt.mode === "topic" ? opt.type || "all" : "all", tag: opt.tag || "", open: "" }; paintGrid(); if (!$("topicsPage").open) $("topicsPage").showModal(); $("topicsPage").scrollTop = 0; }
function gridItems() {
  const { st, mode, tag } = grid;
  if (mode === "topic") return blogTopics(st).map((g) => ({ key: g.key, type: tType(g.topic), thumb: topicCover(g.topic, "tp-cover"), label: g.topic.title, posts: g.posts }));
  return st.list.filter((b) => (b.tags || []).includes(tag)).map((b) => ({ key: b.id, type: b.topic?.title ? tType(b.topic) : "", thumb: blogThumb(b, "tp-cover"), label: b.title, posts: [b] }));
}
function paintGrid() {
  const all = gridItems();
  $("tpTitle").textContent = grid.mode === "topic" ? `${grid.st.nick}님의 글감` : `#${grid.tag}`;
  $("tpTabs").innerHTML = [["all", "전체"], ...Object.entries(TOPIC).map(([k, v]) => [k, v[0]])]
    .map(([k, v]) => `<button type="button" data-t="${k}" class="${k === grid.type ? "on" : ""}">${v}</button>`).join("");
  const list = grid.type === "all" ? all : all.filter((x) => x.type === grid.type);
  $("tpCount").innerHTML = `<b>${list.length}</b>건`;
  $("tpGrid").innerHTML = list.length ? list.map((x) => `<button type="button" class="tp-item${x.key === grid.open ? " open" : ""}" data-key="${esc(x.key)}">
      ${x.thumb}<span>${esc(x.label)}</span>${x.posts.length > 1 ? `<small>글 ${x.posts.length}</small>` : ""}</button>
      ${x.key === grid.open ? `<div class="tp-more">${x.posts.map((p) => `<button type="button" data-id="${p.id}">${esc(p.title)}</button>`).join("")}</div>` : ""}`).join("")
    : `<p class="muted">이 종류는 아직 없어요.</p>`;
  fillTopicImgs($("tpGrid"));
}
$("tpTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b && grid) { grid.type = b.dataset.t; grid.open = ""; paintGrid(); } });
$("tpGrid").addEventListener("click", (e) => {
  if (!grid) return;
  const p = e.target.closest("[data-id]"); if (p) { openBlogPost(p.dataset.id, grid.st); return; }
  const b = e.target.closest("[data-key]"); if (!b) return;
  const g = gridItems().find((x) => x.key === b.dataset.key); if (!g) return;
  if (g.posts.length === 1) openBlogPost(g.posts[0].id, grid.st);
  else { grid.open = grid.open === g.key ? "" : g.key; paintGrid(); }
});
$("tpClose").addEventListener("click", () => $("topicsPage").close());

// 블로그 글 보기
let blogNow = null, blogSt = null;
const blogViewed = new Set();
async function openBlogPost(id, st = null) {
  blogSt = st;
  if (!$("blogView").open) $("blogView").showModal();
  $("bvTitle").textContent = "불러오는 중…"; for (const x of ["bvMeta", "bvBody", "bvTopic", "bvPhotos", "bvTags", "bvActions"]) $(x).innerHTML = "";
  try {
    const b = await sync.getBlog(id);
    if (!b) { $("blogView").close(); toast("볼 수 없는 글이에요 (지워졌거나 나만 보기로 바뀌었어요)", 3500); return; }
    blogNow = b; paintBlogPost();
    $("blogView").scrollTop = 0;
    if (!blogViewed.has(id)) {
      blogViewed.add(id);
      sync.bumpBlogView(id).then((n) => { if (n != null && blogNow?.id === id && n !== blogNow.views) { blogNow.views = n; paintBlogMeta(); const x = blogSt?.list.find((y) => y.id === id); if (x) x.views = n; } }).catch(() => blogViewed.delete(id));
    }
  } catch { $("bvTitle").textContent = "불러오지 못했어요. 인터넷 연결을 확인해 주세요."; }
}
function paintBlogMeta() {
  const b = blogNow;
  $("bvMeta").innerHTML = `<button type="button" class="nick-link" data-u="${esc(b.user_id)}">${avatar(b.nick, b.face, "av xs")}${esc(b.nick)}</button> · ${ago(b.created_at)}${b.updated_at && Date.parse(b.updated_at) - Date.parse(b.created_at) > 60000 ? " · 고침" : ""} · ${b.is_public ? `조회 ${b.views || 0}` : "🔒 나만 보기"}`;
}
function paintBlogPost() {
  const b = blogNow, mine = b.user_id === sync.myId();
  paintBlogMeta();
  $("bvTitle").textContent = b.title;
  $("bvTopic").innerHTML = b.topic?.title ? topicCardHtml(b.topic) : "";
  fillTopicImgs($("bvTopic"));
  // 글 사이사이에 쓴 순서대로 사진 (예전 글은 사진이 맨 뒤)
  $("bvBody").innerHTML = richHtml(b.body, b.photos || [], "ph-row inl");
  $("bvPhotos").innerHTML = "";
  fillPhotoRows($("bvBody"));
  $("bvTags").innerHTML = (b.tags || []).map((t) => `<button type="button" data-tag="${esc(t)}">#${esc(t)}</button>`).join("");
  $("bvActions").innerHTML = [mine ? actBtn("edit", "pencil", "고치기") : "", mine || sync.amAdmin() ? actBtn("del", "trash", "지우기") : "", !mine && !sync.amAdmin() && sync.myId() ? actBtn("report", "flag", "신고") : ""].join("");
  // 댓글은 공개 글에만
  $("bvCmtWrap").hidden = !b.is_public;
  $("bvComments").innerHTML = ""; $("bvCnt").textContent = ""; setReTo("bv", null);
  if (b.is_public) loadBlogCmts();
}
async function loadBlogCmts() {
  const b = blogNow; if (!b) return;
  try {
    const list = await sync.blogComments(b.id);
    if (blogNow?.id !== b.id) return;
    const me = sync.myId(), owner = b.user_id === me, adm = sync.amAdmin();
    $("bvCnt").textContent = list.length || "";
    $("bvComments").innerHTML = cmtTree(list, (c) => c.user_id === me || owner || adm, !adm);
  } catch { $("bvComments").innerHTML = `<li class="muted">댓글을 불러오지 못했어요</li>`; }
}
$("bvComments").addEventListener("click", async (e) => {
  const rp = e.target.closest("[data-rp]"); if (rp) { reportIt("blog_comment", rp.dataset.rp); return; }
  const r = e.target.closest("[data-r]"); if (r) { setReTo("bv", { id: r.dataset.r, nick: r.dataset.n }); return; }
  const b = e.target.closest("[data-c]"); if (!b || !blogNow) return;
  if (!confirm("이 댓글을 지울까요?")) return;
  try { await sync.deleteBlogComment(b.dataset.c); loadBlogCmts(); }
  catch { toast("지우지 못했어요"); }
});
$("bvCSend").addEventListener("click", async () => {
  const v = $("bvCIn").value.trim(); if (!v || !blogNow) return;
  if (!sync.myNick()) { openNick(false); return; }
  $("bvCSend").disabled = true;
  try { await sync.addBlogComment(blogNow.id, v, reTo.bv?.id || null); $("bvCIn").value = ""; setReTo("bv", null); await loadBlogCmts(); }
  catch (e) { toast(sync.isBanErr(e) ? BAN_MSG : "댓글을 올리지 못했어요. 인터넷 연결을 확인해 주세요", 3500); }
  $("bvCSend").disabled = false;
});
$("bvClose").addEventListener("click", () => $("blogView").close());
$("bvMeta").addEventListener("click", (e) => {
  const b = e.target.closest("[data-u]"); if (!b) return;
  if (blogSt && blogSt.uid === b.dataset.u && (blogSt.me ? !$("momPage").open : $("momPage").open)) { $("blogView").close(); if ($("topicsPage").open) $("topicsPage").close(); return; }
  $("blogView").close(); openMom(b.dataset.u);
});
$("bvTags").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-tag]"); if (!b || !blogNow) return;
  let st = blogSt && blogSt.uid === blogNow.user_id ? blogSt : null;
  if (!st) { try { st = await loadBlog(blogNow.user_id); } catch { toast("불러오지 못했어요"); return; } }
  $("blogView").close();
  openGrid(st, { mode: "tag", tag: b.dataset.tag });
});
$("bvActions").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-a]"); const p = blogNow; if (!b || !p) return;
  if (b.dataset.a === "report") { reportIt("blog", p.id); return; }
  if (b.dataset.a === "edit") { $("blogView").close(); openBlogEdit(p); return; }
  if (!confirm("이 글을 지울까요? 사진도 함께 지워지고 되돌릴 수 없어요.")) return;
  try {
    await sync.deleteBlog(p);
    $("blogView").close(); toast("글을 지웠어요");
    for (const st of [myBlog, momNow, grid?.st]) if (st?.list) st.list = st.list.filter((x) => x.id !== p.id);
    if ($("topicsPage").open) paintGrid();
    if (momNow?.list && $("momPage").open) paintBlog($("momBlog"), momNow);
    if (myBlog) paintBlog($("myBlog"), myBlog);
  } catch { toast("지우지 못했어요. 인터넷 연결을 확인해 주세요"); }
});

// 블로그 글쓰기 · 고치기
let bEditing = null, bTags = [];
const bRich = makeRichCE($("beRich"), { placeholder: "오늘 이야기를 적어 보세요", max: MAX_PHOTOS, onChange: (gone) => { if (gone?.file) URL.revokeObjectURL(gone.url); paintBPhotos(); } });
const MAX_TAGS = 10;
const cleanTag = (t) => String(t || "").replace(/^#+/, "").replace(/[\s,#]+/g, "").slice(0, 20);
function paintBPhotos() {
  const n = bRich.photos().length;
  $("bePhotoCount").textContent = `사진 ${n}/${MAX_PHOTOS}`;
  $("bePhotoAdd").disabled = n >= MAX_PHOTOS;
}
function paintBTags() {
  $("beTags").innerHTML = bTags.map((t, i) => `<button type="button" data-rm="${i}" aria-label="태그 빼기">#${esc(t)} ✕</button>`).join("");
  $("beTagIn").hidden = bTags.length >= MAX_TAGS;
}
function addTagsFrom(text) {
  for (const raw of String(text).split(/[\s,]+/)) {
    const t = cleanTag(raw);
    if (t && !bTags.includes(t) && bTags.length < MAX_TAGS) bTags.push(t);
  }
  paintBTags();
}
function openBlogEdit(b = null) {
  if (!AUTH.user || AUTH.offline) { toast("블로그는 인터넷에 연결돼 있을 때 쓸 수 있어요"); return; }
  if (!sync.myNick()) { openNick(false); return; }
  bEditing = b;
  bRich.photos().forEach((x) => x.file && URL.revokeObjectURL(x.url));
  const items = (b?.photos || []).map((path) => ({ path, url: "" }));
  bRich.set(b?.body || "", items);
  if (b?.photos?.length) sync.photoUrls(b.photos).then((urls) => { const m = new Map(b.photos.map((pa, i) => [pa, urls[i]])); items.forEach((x) => { if (x.path) x.url = m.get(x.path) || ""; }); bRich.refresh(); });
  bTags = [...(b?.tags || [])];
  const cats = sync.myBlogCats();
  $("beCatRow").hidden = !cats.length;
  $("beCat").innerHTML = `<option value="">미분류</option>` + cats.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  $("beCat").value = b?.cat && cats.some((c) => c.id === b.cat) ? b.cat : (!b && myBlog?.cat && myBlog.cat !== NOCAT ? myBlog.cat : "");
  $("beTitle").value = b?.title || ""; $("beTagIn").value = "";
  $("bePublic").checked = b ? !!b.is_public : true;
  $("beSave").textContent = b ? "고치기" : "올리기";
  if (wTopic?.url) URL.revokeObjectURL(wTopic.url);
  topicTo = "beTopic"; wTopic = b?.topic?.title ? { ...b.topic } : null;
  paintBPhotos(); paintBTags(); paintWTopic();
  $("blogEdit").showModal();
  $("blogEdit").scrollTop = 0;
}
$("beClose").addEventListener("click", () => {
  const r = bRich.get();
  if (($("beTitle").value.trim() || r.body) && !bEditing && !confirm("쓰던 글을 버릴까요?")) return;
  $("blogEdit").close();
});
$("bePhotoAdd").addEventListener("mousedown", (e) => e.preventDefault()); // 글 쓰던 자리를 놓치지 않게
$("bePhotoAdd").addEventListener("click", () => $("bePhotoFile").click());
$("bePhotoFile").addEventListener("change", () => {
  const files = pickImages($("bePhotoFile"));
  const room = MAX_PHOTOS - bRich.photos().length;
  if (files.length > room) toast(`사진은 ${MAX_PHOTOS}장까지 넣을 수 있어요`);
  bRich.insert(files.slice(0, room).map((f) => ({ file: f, url: URL.createObjectURL(f) })));
  $("bePhotoFile").value = "";
  paintBPhotos();
});
$("beTopicBtn").addEventListener("click", () => openTopicPick());
// 글씨 크기·색: 버튼을 눌러도 고른 글자가 풀리지 않게
for (const id of ["bePhotoAdd", "beFmt"]) { $(id).addEventListener("pointerdown", (e) => e.preventDefault()); $(id).addEventListener("mousedown", (e) => e.preventDefault()); }
$("beFmt").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.s) bRich.style("s", b.dataset.s); else bRich.style("c", b.dataset.c);
});
$("beTags").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) { bTags.splice(Number(b.dataset.rm), 1); paintBTags(); } });
$("beTagIn").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === "," || e.key === " ") { e.preventDefault(); addTagsFrom($("beTagIn").value); $("beTagIn").value = ""; }
  else if (e.key === "Backspace" && !$("beTagIn").value && bTags.length) { bTags.pop(); paintBTags(); }
});
$("beTagIn").addEventListener("blur", () => { if ($("beTagIn").value.trim()) { addTagsFrom($("beTagIn").value); $("beTagIn").value = ""; } });
$("beTopic").addEventListener("click", (e) => {
  if (e.target.closest("#peTopicRm")) { if (wTopic?.url) URL.revokeObjectURL(wTopic.url); wTopic = null; paintWTopic(); return; }
  if (e.target.closest("#peTopicAdd") || e.target.closest(".topic-card")) openTopicPick();
});
$("beSave").addEventListener("click", async () => {
  const title = $("beTitle").value.trim(), rich = bRich.get();
  if (!title) { toast("제목을 적어 주세요"); $("beTitle").focus(); return; }
  if ($("beTagIn").value.trim()) { addTagsFrom($("beTagIn").value); $("beTagIn").value = ""; }
  $("beSave").disabled = true;
  try {
    const kept = rich.items.filter((x) => x.path).map((x) => x.path);
    const fresh = rich.items.filter((x) => x.file);
    const up = await uploadRich(rich, "blog");
    const body = up.body, paths = up.paths;
    const removed = (bEditing?.photos || []).filter((x) => !kept.includes(x));
    let topic = null;
    if (wTopic) {
      topic = { type: tType(wTopic), title: wTopic.title };
      for (const k of ["cover", "by", "photo"]) if (wTopic[k]) topic[k] = wTopic[k];
      if (wTopic.file) { try { topic.photo = await sync.uploadPhoto(await shrinkPhoto(wTopic.file), "blog"); } catch { /* 사진 없이 */ } }
    }
    const oldTp = bEditing?.topic?.photo;
    if (oldTp && oldTp !== topic?.photo) removed.push(oldTp);
    const id = await sync.saveBlog({ id: bEditing?.id, title, body, photos: paths, topic, tags: bTags, cat: $("beCat").value || null, is_public: $("bePublic").checked });
    if (removed.length) sync.deletePhotos(removed);
    fresh.forEach((x) => URL.revokeObjectURL(x.url)); bRich.clear();
    if (wTopic?.url) URL.revokeObjectURL(wTopic.url);
    wTopic = null;
    $("blogEdit").close();
    toast(bEditing ? "글을 고쳤어요" : "블로그에 올렸어요");
    await renderMyBlog(true);
    openBlogPost(id, myBlog);
  } catch (e) { toast(sync.isBanErr(e) ? BAN_MSG : "올리지 못했어요. 인터넷 연결을 확인해 주세요", 3500); }
  $("beSave").disabled = false;
});

// ---------- 첫 화면 · 로그인 ----------
const welcome = $("welcome");
const hideWelcome = () => { if (welcome.classList.contains("out")) return; welcome.classList.add("out"); setTimeout(() => (welcome.hidden = true), 400); };
let auMode = "login";
function showAuth(mode, msg = "") {
  auMode = mode;
  $("authForm").hidden = false;
  const t = { login: ["로그인", "처음이에요 · 회원가입"], signup: ["회원가입", "이미 가입했어요 · 로그인"],
    reset: ["재설정 메일 보내기", "로그인으로 돌아가기"], newpw: ["새 비밀번호 저장", ""] }[mode];
  $("auGo").textContent = t[0];
  $("auMode").textContent = t[1]; $("auMode").hidden = !t[1];
  $("auForgot").hidden = mode !== "login";
  $("auEmail").hidden = mode === "newpw";
  $("auPass").hidden = mode === "reset";
  $("auPass").value = "";
  $("auPass").placeholder = mode === "newpw" ? "새 비밀번호 (6자 이상)" : "비밀번호 (6자 이상)";
  $("auPass").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("auHelp").textContent = { signup: "가입하면 기록이 계정에 저장돼서 다른 휴대폰에서도 볼 수 있어요.", reset: "가입한 이메일로 비밀번호를 다시 만드는 링크를 보내요.", newpw: "새로 쓸 비밀번호를 적어 주세요." }[mode] || "";
  $("auMsg").textContent = msg;
}
$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("auEmail").value.trim(), pw = $("auPass").value;
  if (auMode !== "newpw" && !/^\S+@\S+\.\S+$/.test(email)) { $("auMsg").textContent = "이메일 주소를 적어 주세요."; return; }
  if (auMode !== "reset" && pw.length < 6) { $("auMsg").textContent = "비밀번호는 6자 이상이에요."; return; }
  $("auGo").disabled = true;
  $("auMsg").textContent = "잠시만요…";
  try {
    if (auMode === "login") { await sync.signIn(email, pw); location.replace(location.pathname); return; }
    if (auMode === "signup") {
      const mailSent = await sync.signUp(email, pw);
      if (!mailSent) { location.replace(location.pathname); return; }
      $("auMsg").textContent = `${email} 으로 인증 메일을 보냈어요. 메일 속 링크를 누르면 시작돼요.`;
    }
    if (auMode === "reset") { await sync.sendReset(email); $("auMsg").textContent = "재설정 메일을 보냈어요. 메일 속 링크를 눌러 주세요."; }
    if (auMode === "newpw") { await sync.newPassword(pw); location.replace(location.pathname); return; }
  } catch (err) { $("auMsg").textContent = sync.koError(err); }
  $("auGo").disabled = false;
});
$("auMode").addEventListener("click", () => showAuth(auMode === "login" ? "signup" : "login"));
$("auForgot").addEventListener("click", () => showAuth("reset"));

if (PEEK) {
  document.body.classList.add("peek");
  $("peekBar").hidden = false;
  hideWelcome();
} else {
  if (PEEK_ID) { history.replaceState(null, "", location.pathname); toast("지금은 볼 수 없는 책장이에요 (나만 보기로 바뀌었을 수 있어요)", 3500); }
  if (!AUTH.user) showAuth("login", AUTH.error ? "인터넷에 연결한 뒤 다시 열어 주세요." : "");
  else if (sync.RECOVERY) showAuth("newpw");
  else if (PROFILE === null) setTimeout(() => { hideWelcome(); openTutorial(() => openNick(true)); }, 900); // 처음 가입: 사용법 → 엄마 별명 → 아이 등록
  else if (!kids.length) setTimeout(() => { hideWelcome(); openKids(true); }, 900);
  else if (PROFILE && PROFILE.tu_seen === false) setTimeout(() => { hideWelcome(); openTutorial(); }, 900); // 이미 가입한 회원: 사용법 한 번
  else { welcome.addEventListener("click", hideWelcome); setTimeout(hideWelcome, 1300); }
}

// ---------- 연산 프린트 ----------
// 문제는 math.js 가 문제지 번호로 만들어요 (같은 번호 = 같은 문제). 처음 열 때만 불러옴
let WSM = null;
const wsLoad = async () => (WSM ||= await import("./math.js"));
const WS_GRADE_KEY = "kbc:wsGrade";
let wsSel = null; // { id, mode, count, ans }
let wsLast = null; // { id, mode, count, ans } — '다른 문제'용
function wsDefaultGrade() {
  const saved = localStore.getItem(WS_GRADE_KEY); if (saved) return saved;
  const k = kids.find((x) => x.id === activeKid); const i = k ? gradeIdx(k) : -1;
  return i >= 5 && i <= 10 ? `E${i - 4}` : i >= 11 && i <= 13 ? `M${i - 10}` : "E1";
}
let wsGrade = null;
function paintWs() {
  const M = WSM;
  // 초등 / 중등을 먼저 고르고, 그 안에서 학년
  const lv = (wsGrade || "E1")[0];
  $("wsGrades").innerHTML = `<div class="ws-lv">${[["E", "초등"], ["M", "중등"]].map(([k, t]) => `<button type="button" data-lv="${k}" aria-pressed="${k === lv}">${t}</button>`).join("")}</div>
    <div class="ws-gr" role="radiogroup" aria-label="학년">${M.CURRICULUM.filter((g) => g.g[0] === lv).map((g) => `<button type="button" role="radio" data-g="${g.g}" aria-checked="${g.g === wsGrade}">${g.g.slice(1)}학년</button>`).join("")}</div>`;
  const gr = M.CURRICULUM.find((g) => g.g === wsGrade) || M.CURRICULUM[0];
  $("wsUnits").innerHTML = gr.units.map((u) => `
    <section class="ws-unit"><h4>${esc(u.name)}${u.sem ? `<small>${u.sem}학기</small>` : ""}</h4>
      <ul class="ws-steps">${u.steps.map((st) => `<li><button type="button" data-id="${st.id}"><span class="no">${M.circ(st.no)}</span><span class="t">${esc(st.title)}</span><small>${st.n}문제${st.v ? " · 세로셈" : ""}</small></button></li>`).join("")}</ul>
    </section>`).join("");
}
async function openWs() {
  try { await wsLoad(); } catch { toast("연산 프린트를 불러오지 못했어요. 인터넷을 확인해 주세요."); return; }
  wsGrade ||= wsDefaultGrade();
  paintWs();
  $("wsPage").showModal();
}
$("wsOpen").addEventListener("click", openWs);
$("wsClose").addEventListener("click", () => $("wsPage").close());
$("wsGrades").addEventListener("click", (e) => {
  const l = e.target.closest("[data-lv]");
  if (l) { if (wsGrade[0] !== l.dataset.lv) { wsGrade = l.dataset.lv + "1"; localStore.setItem(WS_GRADE_KEY, wsGrade); paintWs(); } return; }
  const b = e.target.closest("[data-g]"); if (!b) return;
  wsGrade = b.dataset.g; localStore.setItem(WS_GRADE_KEY, wsGrade); paintWs();
});
const wsSeg = (id, attr, val) => [...$(id).children].forEach((x) => x.setAttribute("aria-checked", String(x.dataset[attr] === String(val))));
$("wsUnits").addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]"); if (!b) return;
  const st = WSM.stepOf(b.dataset.id);
  wsSel = { id: st.id, mode: wsSel?.id === st.id ? wsSel.mode : "h", count: wsSel?.count || 1, ans: wsSel?.ans || false };
  $("wsOptKick").textContent = `${WSM.kickOf(st)} · ${st.total}단계 중 ${st.no}단계`;
  $("wsOptTitle").textContent = `${st.no}) ${st.title}`;
  $("wsModeWrap").hidden = !st.v;
  wsSeg("wsMode", "m", wsSel.mode); paintWsCount();
  $("wsWithAns").checked = wsSel.ans;
  $("wsOpt").showModal();
});
$("wsMode").addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (b && wsSel) { wsSel.mode = b.dataset.m; wsSeg("wsMode", "m", wsSel.mode); } });
// 장 수: 1·2·3장 또는 직접 (1~20장)
function paintWsCount() {
  const custom = wsSel.custom || ![1, 2, 3].includes(wsSel.count);
  wsSeg("wsCount", "n", custom ? "c" : wsSel.count);
  $("wsCntBox").hidden = !custom;
  $("wsCntIn").value = wsSel.count;
}
$("wsCount").addEventListener("click", (e) => {
  const b = e.target.closest("[data-n]"); if (!b || !wsSel) return;
  if (b.dataset.n === "c") { wsSel.custom = true; if (wsSel.count < 4) wsSel.count = 4; }
  else { wsSel.custom = false; wsSel.count = Number(b.dataset.n); }
  paintWsCount();
});
const wsClamp = (n) => Math.max(1, Math.min(20, Math.round(Number(n) || 1)));
$("wsCntBox").addEventListener("click", (e) => { const b = e.target.closest("[data-d]"); if (b && wsSel) { wsSel.count = wsClamp(wsSel.count + Number(b.dataset.d)); $("wsCntIn").value = wsSel.count; } });
$("wsCntIn").addEventListener("input", () => { if (wsSel && $("wsCntIn").value) wsSel.count = wsClamp($("wsCntIn").value); });
$("wsCntIn").addEventListener("change", () => { if (wsSel) { wsSel.count = wsClamp($("wsCntIn").value); $("wsCntIn").value = wsSel.count; } });
$("wsWithAns").addEventListener("change", () => { if (wsSel) wsSel.ans = $("wsWithAns").checked; });
$("wsGo").addEventListener("click", () => {
  if (!wsSel) return;
  $("wsOpt").close();
  wsLast = { ...wsSel };
  wsShow(Array.from({ length: wsSel.count }, () => WSM.makeCode(wsSel.id, wsSel.mode === "v")), wsSel.ans);
});
async function wsShow(codes, withAns) {
  const M = WSM;
  const sheets = codes.map((c) => M.makeSheet(c)).filter(Boolean);
  if (!sheets.length) { toast("문제지 번호를 다시 확인해 주세요"); return; }
  const qrs = await Promise.all(sheets.map((sh) => M.qrSvg(`${location.origin}/ws.html?c=${sh.code}`)));
  const pages = sheets.map((sh, i) => M.sheetHtml(sh, qrs[i]));
  if (withAns) pages.push(M.answerPageHtml(sheets));
  $("wsSheets").innerHTML = pages.map((p) => `<div class="ws-sc">${p}</div>`).join("");
  if (!$("wsPrev").open) $("wsPrev").showModal();
  wsScale();
}
function wsScale() {
  const w = $("wsSheets").clientWidth || 360;
  $("wsSheets").style.setProperty("--s", String(Math.min(1, w / 794)));
}
addEventListener("resize", () => { if ($("wsPrev").open) wsScale(); });
$("wsPrevClose").addEventListener("click", () => $("wsPrev").close());
$("wsRe").addEventListener("click", () => {
  if (!wsLast) { toast("단계를 골라 새로 뽑아 주세요"); return; }
  wsShow(Array.from({ length: wsLast.count }, () => WSM.makeCode(wsLast.id, wsLast.mode === "v")), wsLast.ans);
});
$("wsPrint").addEventListener("click", () => {
  document.body.classList.add("printing-ws");
  window.print(); // 누른 순간 바로 불러야 아이폰이 "자동 프린트 차단"을 띄우지 않아요
});
$("wsPrev").addEventListener("close", () => document.body.classList.remove("printing-ws"));
$("wsCodeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const code = $("wsCodeIn").value.trim().toUpperCase();
  if (!WSM.parseCode(code)) { toast("문제지 번호를 다시 확인해 주세요 (예: E31A2-K4PX)"); return; }
  const c = WSM.parseCode(code);
  wsLast = { id: c.id, mode: c.vertical ? "v" : "h", count: 1, ans: true };
  wsShow([code], true);
});

// ---------- 🔔 새 댓글 알림 (홈 위 종에 N만, 누르면 목록) ----------
const seenKey = () => "kbc-alert-seen-" + sync.myId();
let alerts = [];
async function checkAlerts() {
  $("bellBtn").hidden = !sync.myId();
  if (!sync.myId()) return;
  try {
    alerts = await sync.myAlerts(Date.now() - 30 * 864e5);
    const seen = Number(localStorage.getItem(seenKey()) || 0);
    $("bellN").hidden = !alerts.some((a) => Date.parse(a.created_at) > seen);
  } catch { /* 조용히 넘어가요 */ }
}
$("bellBtn").addEventListener("click", async () => {
  const seen = Number(localStorage.getItem(seenKey()) || 0);
  $("alList").innerHTML = `<li class="muted">불러오는 중…</li>`;
  $("alertPage").showModal();
  await checkAlerts();
  $("alList").innerHTML = alerts.map((a) => `<li><button type="button" class="al-row${Date.parse(a.created_at) > seen ? " new" : ""}" data-src="${a.src}" data-ref="${esc(a.ref)}">
      <span class="al-ic">${{ blog: "📝", guest: "📖", cheer: "👏" }[a.src] || "💬"}</span>
      <span class="al-tx"><span><b>${esc(a.nick || "(알 수 없음)")}</b> 님이 ${a.src === "guest" ? (a.reply ? "방명록에 답글을" : "내 방명록에 글을") : a.src === "cheer" ? "책 기록에 응원을" : a.reply ? "내 댓글에 답글을" : `내 ${a.src === "blog" ? "블로그 글" : "글"}에 댓글을`} ${a.src === "cheer" ? "보냈어요" : "남겼어요"}</span>
        <small>${a.title ? `「${esc(a.title)}」 · ` : ""}${ago(a.created_at)}</small>${a.body ? `<em>${esc(a.body.length > 60 ? a.body.slice(0, 60) + "…" : a.body)}</em>` : ""}</span></button></li>`).join("")
    || `<li class="muted">최근 30일 동안 새 소식이 없어요</li>`;
  localStorage.setItem(seenKey(), String(Date.now()));
  $("bellN").hidden = true;
});
$("alClose").addEventListener("click", () => $("alertPage").close());
$("alList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ref]"); if (!b) return;
  $("alertPage").close();
  const { src, ref } = b.dataset;
  if (src === "blog") openBlogPost(ref);
  else if (src === "guest") { // 내 방명록이면 내 것, 남의 방명록(내 글에 달린 답글)이면 그 집 것
    if (ref === sync.myId()) { go("blog"); renderMyBlog().then(() => myBlog && openGuest(myBlog)); }
    else loadBlog(ref).then((st) => openGuest(st)).catch(() => toast("불러오지 못했어요"));
  } else if (src === "cheer") { go("home"); openView(ref); }
  else openPost(ref);
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkAlerts(); });
setInterval(() => { if (document.visibilityState === "visible") checkAlerts(); }, 3 * 60 * 1000);
checkAlerts();

// 기록 화면에서 아이 바꾸기: 그 아이 책장 기준으로 다시 열어요 (이미 읽던 책이면 이어서)
$("rKids").addEventListener("click", (e) => {
  const b = e.target.closest("[data-kid]"); if (!b || !rec || b.dataset.kid === activeKid) return;
  const { isbn, book, self } = rec, bk = book || (rec.existing ? { title: rec.existing.title, authors: rec.existing.authors ? [rec.existing.authors] : [], publisher: rec.existing.publisher, category: rec.existing.category, pages: rec.existing.totalPages, cover: rec.existing.cover, description: rec.existing.description } : null);
  setKid(b.dataset.kid);
  const pair = recsOf(isbn), ex = chosenShelf === "focus" ? pair.fo : pair.read;
  if (ex && ex.done) { if (!startReread(ex, true)) { $("recordPage").close(); return; } }
  else if (ex) openRecord({ existing: ex, pick: true });
  else openRecord({ isbn, book: bk, self: self && !bk, pick: true });
  toast(`${kidNow()?.nick || ""} 책장에 기록해요`);
});

// ---------- 교과서 수록도서: 제목 옆 학년 동그라미 ----------
// 바코드(ISBN)가 같으면 바로, 아니면 제목+지은이로 맞춰 봐요 (짧은 제목은 지은이까지 같아야 해요)
function nT(s) { return String(s || "").toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, "").replace(/[^0-9a-z가-힣]/g, ""); } // 함수로 둬야 홈 화면(먼저 그림)에서도 쓸 수 있어요
const TB_I = new Map(), TB_T = [];
for (const [t, a, g, is] of TEXTBOOK) {
  for (const i of is.split(" ").filter(Boolean)) TB_I.set(i, (TB_I.get(i) || "") + g);
  TB_T.push([nT(t), a.replace(/\s/g, ""), g]);
}
function tbGrades(isbn, title, authors) {
  const gs = new Set([...(TB_I.get(isbn || "") || "")]);
  const nt = nT(title), au = String(authors || "").replace(/\s/g, "");
  if (nt) for (const [t, a, g] of TB_T) {
    const auOk = a && au.includes(a);
    if ((nt === t && (t.length >= 4 || auOk)) || (auOk && ((t.length >= 3 && nt.startsWith(t)) || (nt.length >= 4 && t.startsWith(nt))))) for (const c of g) gs.add(c);
  }
  return [...gs].sort((p, q) => TB_ORDER.indexOf(p) - TB_ORDER.indexOf(q));
}
const TB_ORDER = "123456중고";

// ---------- 교과서 수록도서 목록 (홈 카드 → 학년 탭 · 검색 · 읽은 책 표시) ----------
const TB_TABS = ["1", "2", "3", "4", "5", "6", "중"]; // 고등 목록은 빼기로 함 (책 제목 옆 학년 동그라미에는 그대로)
function tbName(g) { return g === "중" ? "중학교" : g === "고" ? "고등학교" : `${g}학년`; }
let tbTab = null;
// 이 아이가 기록한 책과 교과서 목록 맞춰 보기 → { 목록 번호: 기록 }
function tbMine() {
  const hit = new Map();
  TEXTBOOK.forEach(([t, a, , is], i) => {
    const isbns = is.split(" ").filter(Boolean), nt0 = nT(t), a0 = a.replace(/\s/g, "");
    const r = records.find((r) => {
      if (r.isbn && isbns.includes(r.isbn)) return true;
      const nt = nT(r.title), au = String(r.authors || "").replace(/\s/g, ""), auOk = a0 && au.includes(a0);
      return (nt === nt0 && (nt0.length >= 4 || auOk)) || (auOk && ((nt0.length >= 3 && nt.startsWith(nt0)) || (nt.length >= 4 && nt0.startsWith(nt))));
    });
    if (r) hit.set(i, r);
  });
  return hit;
}
function tbKidTab() {
  const g = gradeOf(kids.find((k) => k.id === activeKid) || {});
  return /^초[1-6]$/.test(g) ? g[1] : /^(중|고|졸업)/.test(g) ? "중" : "1";
}
function renderTbCard() {} // 홈 카드는 정보용 (읽은 권수는 목록 안에서만)
let TB_COVER = {}; // "제목|지은이" → 표지 주소 (tbcovers.js, 목록을 열 때 한 번 불러옴)
function renderTb() {
  const mine = tbMine();
  $("tbTabs").innerHTML = TB_TABS.map((g) => {
    const all = TEXTBOOK.filter((x) => x[2].includes(g)).length;
    const got = TEXTBOOK.map((x, i) => i).filter((i) => TEXTBOOK[i][2].includes(g) && mine.has(i)).length;
    return `<button type="button" role="tab" data-g="${g}" aria-selected="${g === tbTab}"><b>${g === "중" ? "중학교" : `${g}학년`}</b><small>${got}/${all}</small></button>`;
  }).join("");
  const list = TEXTBOOK.map((x, i) => ({ x, i })).filter(({ x }) => x[2].includes(tbTab));
  // 읽은 책을 앞으로, 그다음 표지 있는 책
  list.sort((p, q) => (mine.has(q.i) - mine.has(p.i)) || (!!TB_COVER[q.x[0] + "|" + q.x[1]] - !!TB_COVER[p.x[0] + "|" + p.x[1]]));
  const got = list.filter(({ i }) => mine.has(i)).length;
  $("tbCount").textContent = `${tbName(tbTab)} ${list.length}권 · 읽은 책 ${got}권`;
  $("tbList").innerHTML = list.map(({ x: [t, a], i }) => {
    const r = mine.get(i), c = r?.cover || TB_COVER[t + "|" + a];
    return `<li data-i="${i}" title="${esc(t)} · ${esc(a)}">
      ${c ? `<img class="cover" src="${esc(c)}" alt="${esc(t)}" loading="lazy">` : `<div class="cover tb-nocover"><b>${esc(t)}</b><small>${esc(a)}</small></div>`}
      ${r ? `<span class="done-badge" aria-label="기록한 책">✓</span>` : ""}</li>`;
  }).join("");
  $("tbSrc").textContent = "출처: 교육부·한국교육학술정보원 '독서로' 교과서 수록 도서 + 서점의 학년·학기별 교과서 수록도서 분류 (2026년 11월 정리). 표지는 책 검색으로 찾은 것이라 판이 다를 수 있어요.";
}
$("tbOpen").addEventListener("click", async () => {
  tbTab = tbKidTab();
  renderTb(); $("tbPage").showModal(); $("tbPage").scrollTop = 0;
  if (!Object.keys(TB_COVER).length) { try { TB_COVER = (await import("./tbcovers.js")).TB_COVER; renderTb(); } catch {} }
});
$("tbClose").addEventListener("click", () => $("tbPage").close());
$("tbTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-g]"); if (!b) return; tbTab = b.dataset.g; renderTb(); });
$("tbList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-i]"); if (!b) return;
  const i = Number(b.dataset.i), [t, a, , is] = TEXTBOOK[i], r = tbMine().get(i);
  // 기록한 책도 안 한 책도 책 소개 창부터 (바코드가 없으면 제목·지은이로 찾아서 바코드를 알아냄)
  let isbn = r?.isbn || is.split(" ").find(Boolean);
  if (!isbn) {
    b.classList.add("loading");
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(t)}`);
      const list = res.ok ? (await res.json()).results || [] : [];
      const a0 = a.replace(/\s/g, "").split(/[,·]/)[0].replace(/외.*$/, "");
      const hit = list.find((x) => x.isbn && nT(x.title).startsWith(nT(t)) && a0 && (x.authors || []).join("").replace(/\s/g, "").includes(a0));
      isbn = hit?.isbn;
    } catch {}
    b.classList.remove("loading");
  }
  // 책 소개 + 읽은 친구들 별점 (기록하기는 없음). 목록 위에 겹쳐 열려서 닫으면 목록으로 돌아와요
  const cover = r?.cover || TB_COVER[t + "|" + a] || "";
  if (isbn) { openSheet(isbn, null, { info: true, title: t, author: a, cover }); return; }
  sheet = { isbn: "", book: null, existing: null, fo: null }; sheetMode(true);
  $("sCat").textContent = "교과서 수록도서"; $("sTitle").textContent = t; $("sAuthor").textContent = `〈작가〉 ${a}`;
  $("sPages").textContent = ""; $("sDesc").textContent = "책 소개를 찾지 못했어요"; $("sMine").hidden = true;
  setImg($("sCover"), cover); $("scanSheet").showModal();
  paintRates("", t);
});
const tbHtml = (gs) => gs.length ? `<span class="tb-gs">${gs.map((g) => { const nm = g === "중" ? "중학교" : g === "고" ? "고등학교" : `초등 ${g}학년`; return `<i class="tb-g${g === "중" ? " m" : g === "고" ? " h" : ""}" title="${nm} 교과서 수록도서" aria-label="${nm} 교과서 수록">${g}</i>`; }).join("")}</span>` : "";

// ---------- 서울대 추천도서 (홈 버튼 → 분야 탭 · 표지 책장 · 책 소개) ----------
let SNU = null, SNU_COVER = {}, snuTab = "전체";
const SNU_TABS = ["전체", "문학", "인문", "사회", "과학"];
async function snuLoad() {
  if (!SNU) SNU = (await import("./snu.js")).SNU;
  if (!Object.keys(SNU_COVER).length) { try { SNU_COVER = (await import("./snucovers.js")).SNU_COVER; } catch {} }
}
const snuAu = (i) => SNU[i][1] || SNU_COVER[i]?.[3] || "";
function snuMine() {
  const hit = new Map();
  SNU.forEach(([t], i) => {
    const isbn = SNU_COVER[i]?.[2], nt0 = nT(t), a0 = snuAu(i).replace(/\s/g, "").split(/[,·]/)[0];
    const r = records.find((r) => {
      if (isbn && r.isbn === isbn) return true;
      const nt = nT(r.title), au = String(r.authors || "").replace(/\s/g, ""), auOk = a0 && au.includes(a0);
      return (nt === nt0 && (nt0.length >= 4 || auOk)) || (auOk && nt0.length >= 3 && nt.startsWith(nt0));
    });
    if (r) hit.set(i, r);
  });
  return hit;
}
function renderSnu() {
  const mine = snuMine();
  $("snuTabs").innerHTML = SNU_TABS.map((c) => {
    const ix = SNU.map((x, i) => i).filter((i) => c === "전체" || SNU[i][2] === c);
    return `<button type="button" role="tab" data-c="${c}" aria-selected="${c === snuTab}"><b>${c}</b><small>${ix.filter((i) => mine.has(i)).length}/${ix.length}</small></button>`;
  }).join("");
  const list = SNU.map((x, i) => i).filter((i) => snuTab === "전체" || SNU[i][2] === snuTab);
  $("snuCount").textContent = `${snuTab === "전체" ? "전체" : snuTab} ${list.length}권 · 읽은 책 ${list.filter((i) => mine.has(i)).length}권`;
  $("snuList").innerHTML = list.map((i) => {
    const t = SNU[i][0], a = snuAu(i), r = mine.get(i), c = r?.cover || SNU_COVER[i]?.[0];
    return `<li data-i="${i}" title="${esc(t)}${a ? ` · ${esc(a)}` : ""}">
      ${c ? `<img class="cover" src="${esc(c)}" alt="${esc(t)}" loading="lazy">` : `<div class="cover tb-nocover"><b>${esc(t)}</b><small>${esc(a)}</small></div>`}
      ${r ? `<span class="done-badge" aria-label="기록한 책">✓</span>` : ""}</li>`;
  }).join("");
}
function paintSnu(i) {
  const [, , cat, y0, y1, ny, best, cols] = SNU[i];
  const cs = cols.length > 4 ? `${cols.slice(0, 4).join(", ")} 외 ${cols.length - 4}곳` : cols.join(", ");
  $("sSnu").innerHTML = `<h4>🎓 서울대 신입생 추천 · ${esc(cat)}</h4>
    <div class="sn-g"><div><b>${ny}년</b><small>추천 받은 해</small></div><div><b>${best ? `${best}위` : "–"}</b><small>TOP 순위 최고</small></div><div><b>${cols.length}곳</b><small>단과대 TOP3</small></div></div>
    <p>${y0 === y1 ? `${y0}년` : `${y0}~${y1}년`}${cs ? ` · ${esc(cs)}` : ""}</p>`;
  $("sSnu").hidden = false;
}
$("snuOpen").addEventListener("click", async () => {
  try { await snuLoad(); } catch { toast("목록을 불러오지 못했어요"); return; }
  renderSnu(); $("snuPage").showModal(); $("snuPage").scrollTop = 0;
});
$("snuClose").addEventListener("click", () => $("snuPage").close());
$("snuTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; snuTab = b.dataset.c; renderSnu(); });
$("snuList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-i]"); if (!b) return;
  const i = Number(b.dataset.i), t = SNU[i][0], a = snuAu(i), r = snuMine().get(i);
  const isbn = r?.isbn || SNU_COVER[i]?.[2], cover = r?.cover || SNU_COVER[i]?.[0] || "";
  if (isbn) { openSheet(isbn, null, { info: true, title: t, author: a, cover, snu: i }); return; }
  sheet = { isbn: "", book: null, existing: null, fo: null }; sheetMode(true);
  $("sCat").textContent = "서울대 추천도서"; $("sTitle").textContent = t; $("sAuthor").textContent = a ? `〈작가〉 ${a}` : "";
  $("sPages").textContent = ""; $("sDesc").textContent = ""; $("sMine").hidden = true;
  setImg($("sCover"), cover); paintSnu(i); $("scanSheet").showModal();
  paintRates("", t);
});

// ---------- 신고 ----------
const BAN_MSG = "글쓰기가 잠시 막혀 있어요. 관리자에게 문의해 주세요";
async function reportIt(kind, id) {
  if (!confirm("이 글을 신고할까요?\n관리자가 확인해서 부적절하면 지워요.")) return;
  try { await sync.report(kind, id); toast("신고했어요. 알려 주셔서 고마워요"); }
  catch { toast("신고하지 못했어요. 인터넷 연결을 확인해 주세요"); }
}

// ---------- 👑 회원 관리 (관리자만) ----------
const KIND_KO = { post: "게시판 글", comment: "게시판 댓글", blog: "블로그 글", blog_comment: "블로그 댓글", guest: "방명록" };
const DAY = 864e5;
let admMembers = [], admSort = "recent", admUser = null;
const maskEmail = (e) => String(e || "").replace(/^(.{1,3})[^@]*@.*$/, "$1…@…");
const admDay = (t) => { if (!t) return "-"; const d = new Date(t); return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`; };
const agoText = (t) => { if (!t) return "기록 없음"; const n = Math.floor((Date.now() - Date.parse(t)) / DAY); return n <= 0 ? "오늘 기록" : n === 1 ? "어제 기록" : `${n}일 전`; };
$("setAdmin").addEventListener("click", () => { $("settingsDialog").close(); openAdmin(); });
async function openAdmin() {
  $("admList").innerHTML = `<li class="muted">불러오는 중…</li>`; $("admTiles").innerHTML = ""; $("admRep").hidden = true;
  if (!$("adminPage").open) $("adminPage").showModal();
  try {
    const [ms, reps] = await Promise.all([sync.adminMembers(), sync.adminReports()]);
    admMembers = ms;
    const now = Date.now();
    const tiles = [[ms.length, "전체 회원"], [ms.filter((m) => now - Date.parse(m.joined) < 7 * DAY).length, "이번 주 가입"], [ms.filter((m) => m.last_record && now - Date.parse(m.last_record) < 7 * DAY).length, "이번 주 기록"]];
    $("admTiles").innerHTML = tiles.map(([n, t]) => `<div><b>${n}</b><small>${t}</small></div>`).join("");
    $("admRep").hidden = !reps.length;
    $("admRep").innerHTML = `🚨 신고된 글 <b>${reps.length}개</b> 확인하기 ›`;
    paintAdmList();
  } catch { $("admList").innerHTML = `<li class="muted">불러오지 못했어요. 관리자만 볼 수 있어요.</li>`; }
}
function paintAdmList() {
  const q = $("admQ").value.trim().toLowerCase(), now = Date.now();
  let list = admMembers.filter((m) => !q || (m.nick || "").toLowerCase().includes(q) || (m.email || "").toLowerCase().includes(q));
  const tm = (t) => (t ? Date.parse(t) : 0);
  list = [...list].sort(admSort === "joined" ? (a, b) => tm(b.joined) - tm(a.joined) : admSort === "books" ? (a, b) => b.books - a.books : (a, b) => tm(b.last_record) - tm(a.last_record));
  $("admList").innerHTML = list.map((m) => {
    const tags = [m.user_id === sync.myId() ? `<i class="tag adm">관리자</i>` : "", now - Date.parse(m.joined) < 7 * DAY ? `<i class="tag new">새 회원</i>` : "",
      now - (tm(m.last_record) || tm(m.joined)) > 14 * DAY ? `<i class="tag idle">2주 넘게 쉼</i>` : "", m.banned ? `<i class="tag ban">글쓰기 막힘</i>` : ""].join("");
    return `<li><button type="button" class="adm-row" data-u="${esc(m.user_id)}">${avatar(m.nick || "?", null, "av")}
      <span class="am"><span><b>${esc(m.nick || "(별명 없음)")}</b>${tags}</span><small>${esc(maskEmail(m.email))} · 가입 ${admDay(m.joined)} · 아이 ${m.kids}명${m.writings ? ` · 글 ${m.writings}` : ""}</small></span>
      <span class="ar">${m.books}권<em>${agoText(m.last_record)}</em></span></button></li>`;
  }).join("") || `<li class="muted">찾는 회원이 없어요</li>`;
}
$("admQ").addEventListener("input", paintAdmList);
$("admSort").addEventListener("click", (e) => {
  const b = e.target.closest("[data-s]"); if (!b) return;
  admSort = b.dataset.s; [...$("admSort").children].forEach((x) => x.setAttribute("aria-pressed", String(x === b))); paintAdmList();
});
$("admClose").addEventListener("click", () => $("adminPage").close());
$("admList").addEventListener("click", (e) => { const b = e.target.closest("[data-u]"); if (b) openAdmUser(b.dataset.u); });

// 신고된 글
$("admRep").addEventListener("click", openAdmReports);
async function openAdmReports() {
  $("arList").innerHTML = `<li class="muted">불러오는 중…</li>`;
  if (!$("admRepPage").open) $("admRepPage").showModal();
  try {
    const reps = await sync.adminReports();
    $("arList").innerHTML = reps.map((r) => wRow(r, `신고 ${r.reports}번 · ${r.author ? esc(r.nick || "(별명 없음)") : "(이미 지워진 글)"}`, true)).join("") || `<li class="muted">신고된 글이 없어요 👍</li>`;
  } catch { $("arList").innerHTML = `<li class="muted">불러오지 못했어요</li>`; }
}
$("arClose").addEventListener("click", () => { $("admRepPage").close(); openAdmin(); });
// 글 한 줄 (신고 목록 · 회원 글 목록 같이 씀)
const wRow = (w, who, dismiss) => `<li class="w-row"><div><small>${KIND_KO[w.kind] || ""} · ${admDay(w.created_at)}${who ? ` · ${who}` : ""}${!dismiss && w.reports ? ` · <b class="rp">신고 ${w.reports}</b>` : ""}</small>
  ${w.title ? `<b>${w.kind.endsWith("comment") ? "↳ " : ""}${esc(w.title)}</b>` : ""}<p>${esc(plainText(w.body || ""))}</p></div>
  <span class="w-acts">${w.ref && w.author !== null ? `<button type="button" data-view="${w.kind}" data-ref="${esc(w.ref)}" title="보기" aria-label="보기">${ico("eye")}</button>` : ""}<button type="button" class="del" data-del="${w.kind}" data-id="${esc(w.id)}" title="지우기" aria-label="지우기">${ico("trash")}</button>${dismiss ? `<button type="button" class="ok" data-dis="${w.kind}" data-id="${esc(w.id)}" title="괜찮음 (신고만 정리)" aria-label="괜찮음">${ico("check")}</button>` : ""}</span></li>`;
async function wAction(e, after) {
  const v = e.target.closest("[data-view]"), d = e.target.closest("[data-del]"), s = e.target.closest("[data-dis]");
  if (v) { const k = v.dataset.view, ref = v.dataset.ref;
    if (k === "guest") loadBlog(ref).then((st) => openGuest(st)).catch(() => toast("불러오지 못했어요"));
    else k.startsWith("blog") ? openBlogPost(ref) : openPost(ref); return; }
  if (d) {
    if (!confirm(`이 ${KIND_KO[d.dataset.del]}을(를) 지울까요?\n되돌릴 수 없어요.`)) return;
    try { await sync.adminDelete(d.dataset.del, d.dataset.id); toast("지웠어요"); boardLoaded = ""; after(); } catch { toast("지우지 못했어요"); }
  }
  if (s) { try { await sync.adminDismiss(s.dataset.dis, s.dataset.id); toast("신고를 정리했어요"); after(); } catch { toast("정리하지 못했어요"); } }
}
$("arList").addEventListener("click", (e) => wAction(e, openAdmReports));

// 회원 한 명: 쓴 글 · 전부 지우기 · 글쓰기 막기 · 책장 보기
async function openAdmUser(uid) {
  admUser = admMembers.find((m) => m.user_id === uid); if (!admUser) return;
  const m = admUser, me = uid === sync.myId();
  $("auHead").innerHTML = `${avatar(m.nick || "?", null, "av")}<div><b>${esc(m.nick || "(별명 없음)")}</b><small>${esc(m.email || "")}</small>
    <small>가입 ${admDay(m.joined)} · 마지막 로그인 ${admDay(m.last_sign_in)} · 아이 ${m.kids}명 · 책 ${m.books}권 · ${m.is_public ? "책장 공개" : "🔒 나만 보기"}</small></div>`;
  $("auActs").innerHTML = [m.is_public ? `<button type="button" data-act="shelf">${ico("bookshelf")}책장 보기</button>` : "",
    me ? "" : `<button type="button" data-act="ban" class="${m.banned ? "on" : ""}">${ico("hand-stop")}${m.banned ? "글쓰기 막힘 · 풀기" : "글쓰기 막기"}</button>`,
    me ? "" : `<button type="button" data-act="wipe" class="del">${ico("trash")}쓴 글 전부 지우기</button>`].join("");
  $("auList").innerHTML = `<li class="muted">불러오는 중…</li>`;
  if (!$("admUserPage").open) $("admUserPage").showModal();
  try {
    const ws = await sync.adminWritings(uid);
    $("auCnt").textContent = ws.length ? `${ws.length}개` : "";
    $("auList").innerHTML = ws.map((w) => wRow({ ...w, author: uid }, "", false)).join("") || `<li class="muted">쓴 글이 없어요</li>`;
  } catch { $("auList").innerHTML = `<li class="muted">불러오지 못했어요</li>`; }
}
$("auClose").addEventListener("click", () => { $("admUserPage").close(); openAdmin(); });
$("auList").addEventListener("click", (e) => wAction(e, () => openAdmUser(admUser.user_id)));
$("auActs").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); const m = admUser; if (!b || !m) return;
  if (b.dataset.act === "shelf") { for (const id of ["admUserPage", "adminPage"]) $(id).close(); openMom(m.user_id); return; }
  if (b.dataset.act === "ban") {
    const on = !m.banned;
    if (on && !confirm(`${m.nick || "이 회원"}님이 게시판·블로그에 글과 댓글을 못 쓰게 할까요?\n(독서 기록과 책장은 그대로 쓸 수 있어요. 언제든 다시 풀 수 있어요)`)) return;
    try { await sync.adminSetBan(m.user_id, on); m.banned = on; toast(on ? "글쓰기를 막았어요" : "글쓰기를 다시 풀었어요"); openAdmUser(m.user_id); } catch { toast("바꾸지 못했어요"); }
    return;
  }
  if (b.dataset.act === "wipe") {
    if (!confirm(`${m.nick || "이 회원"}님이 쓴 게시판 글·블로그 글·댓글을 전부 지울까요?\n되돌릴 수 없어요.`)) return;
    if (!confirm("정말 전부 지울까요? 한 번 더 확인해요.")) return;
    try { const n = await sync.adminDeleteAll(m.user_id); toast(`${n || 0}개를 지웠어요`); boardLoaded = ""; openAdmUser(m.user_id); } catch { toast("지우지 못했어요"); }
  }
});

// ---------- 처음 사용법 (6장) — 별명이 아직 없는 새 회원에게 한 번, 설정에서 다시 보기 ----------
let tuAt = 0, tuAfter = null;
const tuCards = () => [...$("tuTrack").children];
function tuGo(n) {
  const cs = tuCards(); tuAt = Math.max(0, Math.min(cs.length - 1, n));
  $("tuTrack").style.transform = `translateX(${-tuAt * 100}%)`;
  [...$("tuDots").children].forEach((d, i) => d.classList.toggle("on", i === tuAt));
  $("tuCnt").textContent = `${tuAt + 1} / ${cs.length}`;
  $("tuPrev").style.visibility = tuAt ? "visible" : "hidden";
  $("tuNext").textContent = tuAt === cs.length - 1 ? (tuAfter ? "시작하기 🍌" : "닫기") : "다음";
}
function openTutorial(after = null) { tuAfter = after; tuGo(0); $("tutorial").showModal(); }
function closeTutorial() { const f = tuAfter; tuAfter = null; $("tutorial").close(); if (PROFILE && PROFILE.tu_seen === false) { PROFILE.tu_seen = true; sync.markTutorialSeen().catch(() => {}); } if (f) setTimeout(f, 150); }
$("tuPrev").addEventListener("click", () => tuGo(tuAt - 1));
$("tuNext").addEventListener("click", () => (tuAt === tuCards().length - 1 ? closeTutorial() : tuGo(tuAt + 1)));
$("tuSkip").addEventListener("click", closeTutorial);
$("tutorial").addEventListener("cancel", (e) => { e.preventDefault(); closeTutorial(); });
$("tuDots").addEventListener("click", (e) => { const i = [...$("tuDots").children].indexOf(e.target); if (i >= 0) tuGo(i); });
// 손가락으로 옆으로 밀어서 넘기기
let tuX = null;
$("tuTrack").addEventListener("touchstart", (e) => { tuX = e.touches[0].clientX; }, { passive: true });
$("tuTrack").addEventListener("touchend", (e) => { if (tuX == null) return; const dx = e.changedTouches[0].clientX - tuX; tuX = null; if (Math.abs(dx) > 40) tuGo(tuAt + (dx < 0 ? 1 : -1)); });
$("setTutorial").addEventListener("click", () => { $("settingsDialog").close("away"); openTutorial(); });
