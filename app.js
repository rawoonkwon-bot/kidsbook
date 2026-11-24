import { Scanner, warmUpDetector } from "./scanner.js";
import { lookupBook } from "./lookup.js";
import { toIsbn13 } from "./isbn.js";
import * as sync from "./sync.js";
import { ico, toIcon, ICON_EMOJI, PICK } from "./icons.js";

const $ = (id) => document.getElementById(id);

// ---------- 로그인 · 다른 집 구경 ----------
// 시작하기 전에 로그인을 확인하고 계정 기록과 맞춤 (그동안 첫 화면이 보임)
const AUTH = await sync.boot();
const PARAMS = new URLSearchParams(location.search);
const PEEK_ID = AUTH.user && !AUTH.offline ? PARAMS.get("peek") : null;
let PEEK = PEEK_ID ? await sync.fetchUser(PEEK_ID).catch(() => null) : null;
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
const STAMPS_PER_BOARD = 8;
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
const pointsOf = (r) => pagesOf(r) + BONUS * (r.bonusRounds || (r.bonus ? [1] : [])).length;
const totalPoints = () => records.reduce((a, r) => a + pointsOf(r), 0);
const pct = (r) => (r.totalPages ? Math.min(100, Math.round((readTo(r) / r.totalPages) * 100)) : 0);
const sessionText = (s) => (s.from && s.to ? `${s.from}~${s.to}쪽` : s.to ? `~${s.to}쪽` : "쪽수 없음") + (s.minutes ? ` · ${fmtMin(s.minutes)}` : "");
const firstDay = (r) => r.sessions.map((s) => s.day).sort()[0];
const lastDay = (r) => r.sessions.map((s) => s.day).sort().at(-1);
function progressText(r) {
  const to = readTo(r);
  if (r.done) return `✅ 다 읽었어요!${r.totalPages ? ` (${r.totalPages}쪽)` : ""}${timesRead(r) > 1 ? ` · ${timesRead(r)}번 읽음` : ""}`;
  const nth = roundOf(r) > 1 ? `${roundOf(r)}번째 읽는 중 · ` : "";
  if (!to) return nth ? `${roundOf(r)}번째 읽기 시작` : "";
  return nth + (r.totalPages ? `진도율 ${pct(r)}% (${to} / ${r.totalPages}쪽)` : `${to}쪽까지 읽었어요`);
}
const hasHangul = (t) => /[가-힣]/.test(t || "");
const shelfOf = (r) => r.shelf || (hasHangul(r.title) ? "ko" : "en");
const stampList = () => records.flatMap((r) => (r.finishes || []).map((f) => ({ r, at: f.at || 0, round: f.round }))).sort((a, b) => a.at - b.at);

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
  if (tab === "stats") { renderStats(); renderBrowse(); }
  if (tab === "port") renderCalendar();
  if (tab === "board") setTimeout(() => renderBoard()); // 게시판 코드가 아래에 있어서 한 박자 뒤에
  if (tab === "home") setTimeout(() => renderPopular());
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
      ${r.done ? `<span class="done-badge" aria-label="다 읽음">✓</span>` : r.totalPages ? `<div class="pbar"><i style="width:${pct(r)}%"></i></div>` : ""}
      ${timesRead(r) ? `<span class="tally-wrap">${tallySvg(timesRead(r))}</span>` : ""}
    </li>`;

function render() {
  const month = localDay().slice(0, 7);
  const inMonth = (r, m) => r.sessions.some((s) => s.day.startsWith(m));
  // 숫자 링
  const monthN = records.filter((r) => inMonth(r, month)).length;
  const stamps = stampList().length;
  const onBoard = stamps === 0 ? 0 : ((stamps - 1) % STAMPS_PER_BOARD) + 1;
  const pts = totalPoints();
  $("ringMonth").innerHTML = ringSvg(0) + `<b>${monthN}<small>권</small></b>`;
  $("ringStamp").innerHTML = ringSvg(onBoard / STAMPS_PER_BOARD) + `<b>${onBoard}<small>/${STAMPS_PER_BOARD}</small></b>`;
  $("ringPoint").innerHTML = ringSvg(0) + `<b style="font-size:${pts >= 10000 ? 16 : 19}px">${pts.toLocaleString()}</b>`;

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
for (const id of ["shelfKo", "shelfEn", "reading"]) {
  const pick = (e) => e.target.closest("[data-id]")?.dataset.id;
  $(id).addEventListener("click", (e) => { const i = pick(e); if (i) openView(i); });
  $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { const i = pick(e); if (i) openView(i); } });
}
$("ringStampBtn").addEventListener("click", () => openStamp(null));

// ---------- 1) 스캔 후 책 정보 시트 ----------
let sheet = null; // { isbn, book, existing }
async function openSheet(isbn, scanInfo) {
  const existing = records.find((r) => r.isbn === isbn) || null;
  sheet = { isbn, book: null, existing };
  $("sCat").textContent = "책 정보";
  $("sTitle").textContent = "책 정보를 찾는 중…";
  $("sAuthor").textContent = ""; $("sPages").textContent = "";
  $("sDesc").textContent = ""; $("sDesc").classList.remove("open");
  $("sTiming").textContent = "";
  $("sMine").hidden = true;
  setImg($("sCover"), existing?.cover);
  $("sOk").disabled = true; $("sOk").textContent = "확인";
  $("scanSheet").showModal();

  let { book, ms, cached } = await lookupBook(isbn, { needDescription: true });
  // 어디에도 없으면, 다른 회원이 직접 등록해 둔 책인지 확인
  if (!book && !PEEK) book = await sync.sharedBook(isbn).catch(() => null);
  if (!sheet || sheet.isbn !== isbn) return;
  sheet.book = book;
  const parts = [];
  if (scanInfo) parts.push(`인식 ${(scanInfo.ms / 1000).toFixed(2)}초`);
  parts.push(cached ? "저장된 정보" : `조회 ${(ms / 1000).toFixed(2)}초${book ? ` · ${book.source}` : ""}`);
  $("sTiming").textContent = parts.join(" · ");
  $("sOk").disabled = false;

  if (!book && !existing) {
    $("sTitle").textContent = "책 정보를 찾지 못했어요";
    $("sAuthor").textContent = "셀프등록에서 제목을 적으면 다른 판의 표지와 쪽수를 찾아 줘요. 한 번 등록하면 다음부터는 누구나 바로 찾아요.";
    $("sOk").textContent = "셀프등록";
    return;
  }
  const b = book || {};
  $("sCat").textContent = b.category || existing?.category || (hasHangul(b.title || existing?.title) ? "한글책" : "영어책");
  $("sTitle").textContent = existing?.title || b.title;
  $("sAuthor").textContent = `〈작가〉 ${existing?.authors || (b.authors || []).join(", ") || "모름"}`;
  const pages = existing?.totalPages || b.pages;
  $("sPages").textContent = `〈페이지〉 ${pages ? `${pages} pages` : "정보 없음"}`;
  setImg($("sCover"), existing?.cover || b.cover);
  $("sDesc").textContent = b.description || existing?.description || "";
  if (existing) {
    $("sMine").hidden = false;
    $("sMine").textContent = existing.done ? `📚 ${timesRead(existing)}번 다 읽은 책이에요 · 기록 보기 ›` : `📚 읽고 있는 책이에요 · ${progressText(existing) || "쪽수 기록 없음"}`;
    $("sMine").classList.toggle("link", !!existing.done);
    $("sOk").textContent = existing.done ? `🔁 다시 읽기 (${roundOf(existing) + 1}번째)` : "이어서 기록하기";
  }
}
$("sDesc").addEventListener("click", () => $("sDesc").classList.toggle("open"));
$("sSelf").addEventListener("click", () => $("scanSheet").close("self"));
$("sMine").addEventListener("click", () => { if ($("sMine").classList.contains("link")) $("scanSheet").close("view"); });
// 다 읽은 책 다시 읽기 (같은 해에 20번까지)
function startReread(r) {
  if (readsThisYear(r) >= MAX_READS_PER_YEAR) {
    toast(`같은 책은 한 해에 ${MAX_READS_PER_YEAR}번까지 기록할 수 있어요. 내년에 다시 기록해 주세요`, 3800);
    return;
  }
  openRecord({ existing: r, reread: true });
}
$("scanSheet").addEventListener("close", () => {
  const v = $("scanSheet").returnValue;
  const s = sheet; sheet = null;
  if (!s || (v !== "ok" && v !== "self" && v !== "view")) return; // ✕ = 검색만 하고 끝
  if (v === "view" && s.existing) { openView(s.existing.id); return; }
  if (s.existing) { s.existing.done && v === "ok" ? startReread(s.existing) : openRecord({ existing: s.existing }); return; }
  openRecord({ isbn: s.isbn, book: s.book, self: v === "self" || !s.book });
});

// ---------- 2) 책 기록 화면 ----------
let rec = null; // { existing, isbn, book, self }
let rDay = localDay();
let chosenShelf = "ko";
const paintShelf = () => {
  [...$("shelfPick").children].forEach((x) => x.setAttribute("aria-checked", String(x.dataset.shelf === chosenShelf)));
  $("focusRow").hidden = chosenShelf !== "focus";
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

function openRecord({ existing = null, isbn = null, book = null, self = false, reread = false }) {
  rec = { existing, isbn: existing?.isbn || isbn, book, self, reread };
  const b = book || {};
  const title = existing?.title || b.title || "";
  const authors = existing?.authors || (b.authors || []).join(", ");
  const publisher = existing?.publisher || b.publisher || "";
  const category = existing?.category || b.category || "";
  const total = existing?.totalPages || b.pages || null;
  const desc = existing?.description || b.description || "";

  setImg($("rCover"), existing?.cover || b.cover);
  $("rTitleText").textContent = title;
  $("rTitleText").hidden = self;
  $("rTitle").hidden = !self; $("rAuthor").hidden = !self;
  $("rTitle").value = title; $("rAuthor").value = authors;
  $("rFind").hidden = !self; $("rFindList").hidden = true; $("rFindList").innerHTML = "";
  $("rMeta").textContent = [publisher && `(출판사) ${publisher}`, !self && authors && `(작가) ${authors}`, category && `(분야) ${category}`, total && `${total} pages`]
    .filter(Boolean).join("\n") || (rec.isbn ? `ISBN ${rec.isbn}` : "");
  $("rDesc").textContent = desc; $("rDesc").classList.remove("open");
  $("rDescHead").hidden = !desc;

  chosenShelf = existing ? shelfOf(existing) : preferShelf || (title ? (hasHangul(title) ? "ko" : "en") : (rec.isbn?.startsWith("97911") || rec.isbn?.startsWith("97889") ? "ko" : "en"));
  paintShelf();
  rDay = returnDay || localDay(); paintDate();

  const prev = existing && !reread ? readTo(existing) : 0;
  $("soFar").hidden = !prev && !reread;
  $("soFar").textContent = reread ? `🔁 ${roundOf(existing) + 1}번째 읽기를 시작해요! 1쪽부터 다시 기록해요`
    : prev ? `지난번까지 ${prev}쪽 읽었어요 → 오늘은 ${prev + 1}쪽부터` : "";
  $("rTotal").value = total || "";
  $("rTo").value = ""; $("rMin").value = ""; $("rHour").value = "";
  $("rTo").placeholder = prev ? `${prev + 1}쪽부터 몇 쪽까지?` : "몇 쪽까지";
  // 새 책이고 전체 쪽수를 알면 '다 읽은 책'을 기본으로 (한 번에 다 읽는 그림책이 많아서)
  $("rDone").checked = (!existing || reread) && !!total;
  $("rHome").checked = !!existing?.home;
  $("pagesLabel").textContent = prev ? "오늘 몇 쪽까지 읽었나요? / (전체 페이지)" : "읽은 페이지 / (전체 페이지)";
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
  const title = rec.self ? $("rTitle").value.trim() : (r0?.title || rec.book?.title || "");
  if (!title) { toast("책 제목을 적어 주세요"); $("rTitle").focus(); return; }
  if (done && !total) { toast("전체 쪽수를 적어 주세요"); $("rTotal").focus(); return; }
  if (!to) { toast("몇 쪽까지 읽었는지 적어 주세요"); $("rTo").focus(); return; }
  if (total && to > total) { toast(`전체 쪽수(${total}쪽)보다 클 수 없어요`); return; }
  if (to <= prev) { toast(`지난번(${prev}쪽)보다 뒤의 쪽을 적어 주세요`); return; }

  const minutes = chosenShelf === "focus" ? ((parseInt($("rHour").value, 10) || 0) * 60 + (parseInt($("rMin").value, 10) || 0)) || null : null;
  if (chosenShelf === "focus" && !minutes) { toast("집중듣기 시간을 적어 주세요"); $("rMin").focus(); return; }
  if (rDay > localDay()) { rDay = localDay(); paintDate(); toast("오늘 이후 날짜는 고를 수 없어요"); return; }

  const session = { from: prev + 1, to, day: rDay, ...(minutes ? { minutes } : {}) };
  let r;
  if (r0) {
    r = r0;
    if (rec.reread) { r.round = roundOf(r) + 1; r.done = false; delete r.doneAt; delete r.doneDay; }
    if (roundOf(r) > 1) session.round = roundOf(r);
    r.sessions.push(session);
    r.shelf = chosenShelf;
    if (total) r.totalPages = total;
    if ($("rHome").checked) r.home = true; else delete r.home;
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
      done: false, score: null, note: "", bonus: false, finishes: [], bonusRounds: [],
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
  flow = { r, pages: gained };
  $("recordPage").close("saved");
  if (finished) $("finishSheet").showModal();
  else burst(gained, () => toast(`📖 ${to}쪽까지 읽었어요!`));
}
$("rSave").type = "button";
$("rSave").addEventListener("click", saveRecord);
["rTo", "rTotal", "rHour", "rMin"].forEach((id) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveRecord(); } }));
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
$("stars").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-label="${n}점" data-n="${n}">${STAR}</button>`).join("");
const paintStars = () => [...$("stars").children].forEach((b) => {
  const n = Number(b.dataset.n);
  b.classList.toggle("lit", n <= stars); b.setAttribute("aria-checked", String(n === stars));
});
$("stars").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const n = Number(b.dataset.n); stars = stars === n ? n - 1 : n; paintStars(); });
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

// ---------- 5) 독서 스탬프 ----------
function openStamp(newId) {
  const list = stampList();
  const n = list.length;
  const board = n === 0 ? 0 : Math.floor((n - 1) / STAMPS_PER_BOARD);
  const on = list.slice(board * STAMPS_PER_BOARD, board * STAMPS_PER_BOARD + STAMPS_PER_BOARD);
  $("stampCount").textContent = `(${on.length}/${STAMPS_PER_BOARD})`;
  $("stampGrid").innerHTML = Array.from({ length: STAMPS_PER_BOARD }, (_, i) => {
    const x = on[i];
    if (!x) return `<div class="stamp" aria-label="빈 칸">📖</div>`;
    const r = x.r, isNew = r.id === newId && x.round === (r.finishes || []).at(-1)?.round;
    return `<div class="stamp on${isNew ? " new" : ""}" title="${esc(r.title)}${x.round > 1 ? ` (${x.round}번째)` : ""}">${r.cover ? `<img src="${esc(r.cover)}" alt="">` : ""}</div>`;
  }).join("");
  const boards = Math.floor(n / STAMPS_PER_BOARD);
  $("stampBoards").textContent = boards ? `지금까지 완성한 스탬프판: ${boards}장 🎉` : "";
  if (!$("stampPage").open) $("stampPage").showModal();
}

// ---------- 책장에서 책 눌렀을 때 ----------
let viewing = null;
$("vCat").innerHTML = `<option value="">미분류</option>` + BOOK_CATS.map((c) => `<option>${c}</option>`).join("");
function openView(id) {
  const r = records.find((x) => x.id === id); if (!r) return;
  viewing = r;
  fillView(r);
  $("viewDialog").showModal();
}
function fillView(r) {
  setImg($("vCover"), r.cover);
  $("vTitle").textContent = r.title;
  $("vAuthor").textContent = r.authors || "";
  $("vMeta").textContent = [SHELVES[shelfOf(r)], r.totalPages && `${r.totalPages}쪽`, minsOf(r) && `${fmtMin(minsOf(r))} 들음`, `${pointsOf(r)}점`].filter(Boolean).join(" · ");
  $("vProgress").innerHTML = progressText(r)
    ? `<b>${esc(progressText(r))}</b>${r.totalPages ? `<div class="bar"><i style="width:${pct(r)}%"></i></div>` : ""}` : "";
  const rounds = roundOf(r);
  $("vSessions").innerHTML = Array.from({ length: rounds }, (_, i) => i + 1).map((n) => {
    const ss = roundSessions(r, n).sort((a, b) => a.day.localeCompare(b.day));
    const fin = (r.finishes || []).find((f) => f.round === n);
    const head = rounds > 1 || fin ? `<li class="round-h"><b>${n}번째</b><span>${ss[0] ? shortDay(ss[0].day) : ""}${fin ? ` ~ ${shortDay(fin.day)} · 다 읽음` : " ~ 읽는 중"}</span></li>` : "";
    return head + ss.map((s) => `<li><span>${prettyDay(s.day)}</span><b>${sessionText(s)}</b></li>`).join("");
  }).join("");
  $("vHome").checked = !!r.home; $("vHome").disabled = !!PEEK;
  $("vTimes").innerHTML = timesRead(r) ? `${tallySvg(timesRead(r))}<span>${timesRead(r)}번 읽었어요</span>` : "";
  $("vMore").hidden = false;
  $("vMore").textContent = r.done ? `🔁 다시 읽기 (${rounds + 1}번째)` : "➕ 이어서 기록하기";
  $("vActivity").hidden = !(r.done && !(r.bonusRounds || []).includes(rounds));
  $("vScore").textContent = r.score ? `${"★".repeat(r.score)}${"☆".repeat(5 - r.score)}  ${r.score}점` : "주지 않았어요";
  $("vNote").textContent = r.note || "적지 않았어요";
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
const PH = { listen: "예: Peppa Pig 3화", focus: "예: Magic Tree House 1권", math: "예: 연산 문제집 12~15쪽", etc: "예: 피아노 연습" };
// 카테고리마다 아이콘 색
const CAT_COLOR = { ko: "#2F5D3A", en: "#6F9F97", listen: "#C89B3C", focus: "#D4537E", memo: "#534AB7", math: "#185FA5", etc: "#BA7517", secret: "#5F5E5A" };
function decorate(c) {
  const d = { ...c, icon: toIcon(c.icon), color: CAT_COLOR[c.key] || "#2F5D3A" };
  d.svg = ico(d.icon, "", d.color);
  if (c.kind === "book") d.book = true;
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
const countOn = (day, c) => (c.book || c.hybrid ? booksOn(day, c.key).length : 0) + (c.book ? 0 : journalOn(day, c.key).length);
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
    const cls = [out && "out", day === today && "today", cats.length && "has"].filter(Boolean).join(" ");
    // 아이콘은 3개씩 2줄(최대 6개), 넘치면 5개 + "+숫자"
    const shown = cats.length > 6 ? cats.slice(0, 5) : cats;
    const icons = shown.map((c) => c.svg).join("") + (cats.length > 6 ? `<span class="more">+${cats.length - 5}</span>` : "");
    html += `<button type="button" class="${cls}" data-day="${day}" ${day > today || out ? "disabled" : ""} aria-label="${prettyDay(day)}${cats.length ? ` · ${cats.map((c) => c.name).join(", ")}` : ""}">
      <span class="dn">${d.getDate()}</span>${cats.length ? `<span class="ig">${icons}</span>` : ""}</button>`;
  }
  $("calGrid").innerHTML = html;
  $("calLegend").innerHTML = count ? `이번 달 <b>${count}</b>일 기록했어요` : "이 달에는 아직 기록이 없어요";
}
$("calPrev").addEventListener("click", () => { const [y, m] = calYM.split("-").map(Number); calYM = localDay(new Date(y, m - 2, 1)).slice(0, 7); renderCalendar(); });
$("calNext").addEventListener("click", () => { const [y, m] = calYM.split("-").map(Number); calYM = localDay(new Date(y, m, 1)).slice(0, 7); renderCalendar(); });
$("calGrid").addEventListener("click", (e) => { const b = e.target.closest("button[data-day]"); if (b && !b.disabled) openDay(b.dataset.day); });

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
        <button type="button" class="btn ghost" data-act="isbn" style="background:var(--soft)">ISBN 입력</button>
        <button type="button" class="btn ghost" data-act="title" style="background:var(--soft)">바코드 없는 책</button>
        ${c.hybrid ? `<button type="button" class="btn ghost" data-act="entry" style="background:var(--soft)">✏️ 직접 적기</button>` : ""}
      </div>`;
    html += ongoing.length ? `<small>읽고 있는 ${c.name} (누르면 이 날 읽은 쪽수를 기록해요)</small>` +
      ongoing.map((r) => `<div class="day-item link" data-more="${r.id}">
        ${r.cover ? `<img src="${esc(r.cover)}" alt="">` : `<span>${c.svg}</span>`}
        <div class="grow"><b>${esc(r.title)}</b><small>${progressText(r) || "아직 쪽수 기록 없음"}</small></div><span>➕</span></div>`).join("")
      : `<small>읽고 있는 ${c.name} 책이 없어요. 책 스캔으로 새 책을 기록해 보세요.</small>`;
  } else {
    // 카테고리마다 한 블록: 앞에 카테고리 이름, 안에 그날 기록들
    for (const c of CATS) {
      let rows = "", n = 0;
      if (c.book || c.hybrid) {
        for (const { r, s } of booksOn(day, c.key)) {
          n++;
          rows += `<div class="day-item link" data-view="${r.id}">
            ${r.cover ? `<img src="${esc(r.cover)}" alt="">` : `<span>${c.svg}</span>`}
            <div class="grow"><b>${esc(r.title)}</b><small>${sessionText(s)}</small></div></div>`;
        }
      }
      if (!c.book) {
        for (const j of journalOn(day, c.key)) {
          n++;
          const sub = [j.minutes ? fmtMin(j.minutes) : "", j.text || ""].filter(Boolean).join(" · ");
          rows += `<div class="day-item link" data-edit="${j.id}"><span>${c.svg}</span>
            <div class="grow"><b>${esc(j.what || c.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}${j.photos?.length ? `<div class="ph-row" data-paths="${esc(j.photos.join("|"))}"></div>` : ""}</div>
            <button type="button" class="x" data-del="${j.id}" aria-label="지우기">✕</button></div>`;
        }
      }
      if (n) html += `<section class="day-group"><h4 class="dg-head" style="color:${c.color}">${c.svg}<b>${esc(c.name)}</b><small>${n}</small></h4>${rows}</section>`;
    }
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
  $("eTitle").textContent = `${c.name}${entry ? " 고치기" : ""} · ${prettyDay(entry?.day || openDayKey)}`;
  $("eWhatWrap").hidden = !c.what; $("eWhatLabel").textContent = c.what || ""; $("eWhat").placeholder = c.whatPh || ""; $("eWhat").value = "";
  $("eAmountWrap").hidden = !c.amount; $("eAmountLabel").textContent = (c.amount || "").replace("몇 분", "얼마나"); $("eUnit").textContent = c.unit || ""; $("eAmount").value = ""; $("eHour").value = "";
  $("eTextWrap").hidden = false; $("eTextLabel").textContent = c.text || "한 줄 메모 (선택)"; $("eText").placeholder = c.textPh || ""; $("eText").value = "";
  $("eText").rows = c.kind === "note" ? 9 : c.text ? 5 : 2;
  ePhotos.forEach((p) => p.file && URL.revokeObjectURL(p.url)); ePhotos = [];
  if (entry) {
    $("eWhat").value = entry.what || ""; $("eText").value = entry.text || "";
    if (entry.minutes) { $("eHour").value = Math.floor(entry.minutes / 60) || ""; $("eAmount").value = entry.minutes % 60 || ""; }
    ePhotos = (entry.photos || []).map((path) => ({ path, url: "" }));
    const paths = entry.photos || [];
    if (paths.length) sync.photoUrls(paths).then((urls) => {
      const map = new Map(paths.map((pa, i) => [pa, urls[i]]));
      ePhotos.forEach((p) => { if (p.path) p.url = map.get(p.path) || ""; });
      paintPhotos();
    });
  }
  $("ePhotoWrap").hidden = c.kind !== "note"; paintPhotos();
  $("dayDialog").close("away"); returnDay = openDayKey || returnDay;
  $("entryDialog").showModal();
}
// 일기 사진: 최대 10장, 올리기 전에 작게 줄임(긴 쪽 1280px)
const MAX_PHOTOS = 10;
let ePhotos = []; // [{ file, url }]
function paintPhotos() {
  $("ePhotoCount").textContent = `${ePhotos.length}/${MAX_PHOTOS}`;
  $("ePhotos").innerHTML = ePhotos.map((p, i) => `<span class="ph"><img src="${p.url}" alt=""><button type="button" data-rm="${i}" aria-label="사진 빼기">✕</button></span>`).join("");
  $("ePhotoAdd").hidden = ePhotos.length >= MAX_PHOTOS;
}
$("ePhotoAdd").addEventListener("click", () => $("ePhotoFile").click());
$("ePhotoFile").addEventListener("change", () => {
  const files = [...$("ePhotoFile").files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
  const room = MAX_PHOTOS - ePhotos.length;
  if (files.length > room) toast(`사진은 ${MAX_PHOTOS}장까지 넣을 수 있어요`);
  for (const f of files.slice(0, room)) ePhotos.push({ file: f, url: URL.createObjectURL(f) });
  $("ePhotoFile").value = "";
  paintPhotos();
});
$("ePhotos").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rm]"); if (!b) return;
  const [p] = ePhotos.splice(Number(b.dataset.rm), 1); if (p.file) URL.revokeObjectURL(p.url); paintPhotos();
});
async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  const s = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", 0.82));
}
$("entryDialog").addEventListener("close", async () => {
  if ($("entryDialog").returnValue !== "save" || !entryCat) return;
  const cat = entryCat; entryCat = null;
  const old = editEntry; editEntry = null;
  const what = $("eWhat").value.trim(), text = $("eText").value.trim(), minutes = ((parseInt($("eHour").value, 10) || 0) * 60 + (parseInt($("eAmount").value, 10) || 0)) || null;
  const all = ePhotos; ePhotos = [];
  const kept = all.filter((p) => p.path).map((p) => p.path);
  const picked = all.filter((p) => p.file);
  if (!what && !text && !minutes && !all.length) { toast("내용을 적어 주세요"); return; }
  const entry = old || { id: crypto.randomUUID?.() || String(Date.now()), day: returnDay || localDay(), cat };
  if (old) {
    const removed = (old.photos || []).filter((p) => !kept.includes(p));
    if (removed.length) sync.deletePhotos(removed);
  }
  Object.assign(entry, { what, minutes, text });
  if (kept.length) entry.photos = kept; else delete entry.photos;
  if (picked.length) {
    const paths = [];
    if (!sync.canUpload()) toast("사진은 인터넷에 연결돼 있을 때 올릴 수 있어요. 글만 저장했어요", 3500);
    else {
      for (let i = 0; i < picked.length; i++) {
        toast(`사진 올리는 중 ${i + 1}/${picked.length}`, 60000);
        try { paths.push(await sync.uploadPhoto(await shrinkPhoto(picked[i].file), cat === "secret" ? "private" : "")); } catch { /* 이 사진은 건너뜀 */ }
      }
      if (paths.length < picked.length) toast(`사진 ${picked.length - paths.length}장은 올리지 못했어요`, 3500);
    }
    if (paths.length) entry.photos = [...kept, ...paths];
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
  const pages = records.reduce((a, r) => a + pagesOf(r), 0);
  const done = records.reduce((a, r) => a + timesRead(r), 0);
  const focusMins = records.reduce((a, r) => a + minsOf(r), 0) + journal.filter((j) => j.cat === "focus").reduce((a, j) => a + (j.minutes || 0), 0);
  const recDays = new Set([...records.flatMap((r) => r.sessions.map((s) => s.day)), ...journal.map((j) => j.day)]).size;
  $("statTiles").innerHTML = [
    ["읽은 책", records.length, "권"], ["끝까지 읽은 횟수", done, "번"],
    ["읽은 쪽수", pages.toLocaleString(), "쪽"], ["독서 포인트", totalPoints().toLocaleString(), "점"],
    ["집중듣기 시간", fmtMin(focusMins), ""], ["기록한 날", recDays, "일"],
  ].map(([k, v, u]) => `<div class="tile"><small>${k}</small><b>${v}<em>${u}</em></b></div>`).join("");

  // 한글책 / 영어책 / 집중듣기
  const groups = Object.keys(SHELVES).map((k) => {
    const list = records.filter((r) => shelfOf(r) === k);
    return { k, n: list.length, p: list.reduce((a, r) => a + pagesOf(r), 0), color: `var(--${k === "focus" ? "fo" : k})` };
  });
  const sum = groups.reduce((a, g) => a + g.n, 0);
  $("statSplit").innerHTML = sum ? `
    <div class="split-bar" role="img" aria-label="${groups.map((g) => `${shelfName(g.k)} ${g.n}권`).join(", ")}">
      ${groups.filter((g) => g.n).map((g) => `<i style="width:${(g.n / sum) * 100}%;background:${g.color}" title="${shelfName(g.k)} ${g.n}권"></i>`).join("")}
    </div>
    <div class="split-legend">
      ${groups.map((g) => `<span><i style="background:${g.color}"></i>${shelfName(g.k)} <b>${g.n}권</b> <em>${g.p.toLocaleString()}쪽</em></span>`).join("")}
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
  for (const r of records) for (const s of r.sessions) { const m = s.day.slice(0, 7); if (m in mp) mp[m] += sessionPages(s); }
  const mmax = Math.max(1, ...Object.values(mp));
  $("statMonths").innerHTML = months.map((m) => `
    <div class="vbar" title="${m} ${mp[m]}쪽">${mp[m] ? `<b>${mp[m]}</b>` : ""}<i style="height:${(mp[m] / mmax) * 82}%"></i><small>${Number(m.slice(5))}월</small></div>`).join("");
}

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
function openTitle() {
  $("tIn").value = ""; $("tMine").innerHTML = "";
  $("titleDialog").showModal();
  setTimeout(() => $("tIn").focus(), 50);
}
$("tIn").addEventListener("input", () => {
  const q = normTitle($("tIn").value);
  const hits = q.length < 2 ? [] : records.filter((r) => normTitle(r.title).includes(q)).slice(0, 5);
  $("tMine").innerHTML = hits.length ? `<small>내 책장에 있는 책이면 눌러 주세요</small>` + hits.map((r) => `<button type="button" class="find-item" data-id="${r.id}">
      ${r.cover ? `<img src="${esc(r.cover)}" alt="">` : `<span class="noimg"></span>`}
      <span><b>${esc(r.title)}</b><small>${esc(progressText(r) || "")}</small></span></button>`).join("") : "";
});
$("tIn").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("titleDialog").close("new"); } });
$("tMine").addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]"); if (!b) return;
  const r = records.find((x) => x.id === b.dataset.id); if (!r) return;
  $("titleDialog").close("pick");
  r.done ? startReread(r) : openRecord({ existing: r });
});
$("titleDialog").addEventListener("close", () => {
  const v = $("titleDialog").returnValue;
  if (v === "pick") return;
  if (v !== "new") { maybeReturn(); return; }
  const t = $("tIn").value.trim();
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
const PICK_ALL = [["book", "책"], ["abc", "영어"], ["headphones", "듣기"], ["ear", "귀"], ["pencil", "메모"], ["math-symbols", "수학"], ["star", "별"], ...PICK];
let catDraft = [], newKind = "time", newIcon = "star", pickFor = "new"; // pickFor: "new" 또는 목록 번호
const catColor = (c) => CAT_COLOR[c.key] || "#2F5D3A";
const LOCKED = (c) => c.kind === "book" || c.kind === "focus" || c.key === "secret";
const KIND_NAME = { book: "책장", focus: "책장+시간", time: "한 것+시간", note: "메모" };
$("cEmoji").innerHTML = PICK_ALL.map(([n, label]) => `<button type="button" data-e="${n}" aria-label="${label} 아이콘 고르기">${ico(n)}<small>${label}</small></button>`).join("");
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
    <button type="button" data-hide aria-label="${c.hidden ? "보이기" : "숨기기"}">${c.hidden ? "🙈" : "👁"}</button>
    ${LOCKED(c) ? `<span class="lock" title="${c.key === "secret" ? "비밀 메모는 지울 수 없고 숨기기만 돼요" : "책장과 연결돼 있어서 숨기기만 돼요"}">🔒</span>` : `<button type="button" data-rm aria-label="${esc(c.name)} 삭제">🗑</button>`}
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
async function renderBrowse() {
  $("browseWrap").hidden = !!(PEEK || !AUTH.user || AUTH.offline);
  if ($("browseWrap").hidden) return;
  if (browseLoaded) return;
  browseLoaded = true;
  $("browse").innerHTML = `<small class="muted">불러오는 중…</small>`;
  try {
    const moms = await sync.listMoms();
    moms.forEach((m) => momCache.set(m.user_id, m));
    $("browse").innerHTML = moms.length
      ? moms.map((m) => `<button type="button" class="kid mom" data-u="${esc(m.user_id)}">${esc(m.nick)}</button>`).join("")
      : `<small class="muted">아직 공개된 다른 책장이 없어요.</small>`;
    moms.slice(0, 8).forEach((m) => prefetchPeek(m.user_id));
  } catch {
    browseLoaded = false;
    $("browse").innerHTML = `<small class="muted">불러오지 못했어요. 인터넷 연결을 확인해 주세요.</small>`;
  }
}
$("browse").addEventListener("pointerdown", (e) => { const b = e.target.closest("[data-u]"); if (b) prefetchPeek(b.dataset.u); });
$("browse").addEventListener("click", (e) => { const b = e.target.closest("[data-u]"); if (b) openMom(b.dataset.u); });
// 앱을 다시 열지 않고 화면만 친구 책장으로 바꾸기 (구경하는 동안은 휴대폰에 아무것도 저장하지 않음)
function enterPeek(data, kid) {
  fillMem(data, kid);
  PEEK = data; store = memStore;
  loadState();
  document.body.classList.add("peek"); $("peekBar").hidden = false;
  renderKids(); render(); go("home");
}
function exitPeek() {
  if (PARAMS.get("peek")) { location.href = "/#stats"; return; } // 주소로 들어온 구경은 다시 열기
  PEEK = null; store = localStore; mem.clear();
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
      add(j.day, `<li>${ICON_EMOJI[toIcon(c.icon)] || "•"} ${esc(c.name)}${j.what ? ` · <b>${esc(j.what)}</b>` : ""}${j.minutes ? ` · ${fmtMin(j.minutes)}` : ""}${j.text ? `<div class="memo">${esc(j.text)}</div>` : ""}${j.photos?.length ? `<div class="memo">📷 사진 ${j.photos.length}장 (앱에서 볼 수 있어요)</div>` : ""}</li>`);
    }
    const pages = recs.reduce((a, r) => a + pagesOf(r), 0), pts = recs.reduce((a, r) => a + pointsOf(r), 0);
    return `<section><h2>🍌 ${esc(k.nick)}${gradeOf(k) ? " " + gradeOf(k) : ""}</h2>
      <p class="sum">책 ${recs.length}권 · 끝까지 읽은 횟수 ${recs.reduce((a, r) => a + (r.finishes || []).length, 0)}번 · ${pages.toLocaleString()}쪽 · 독서 포인트 ${pts.toLocaleString()}점</p>
      <h3>📅 날짜별 기록</h3>
      ${Object.keys(days).sort().reverse().map((day) => `<div class="day"><h4>${plainDay(day)}</h4><ul>${days[day].join("")}</ul></div>`).join("") || "<p>기록이 없어요</p>"}
      <h3>📚 읽은 책</h3>
      ${recs.length ? `<table><thead><tr><th>책</th><th>책장 · 분야</th><th>읽은 쪽</th><th>별점</th><th>내 생각</th></tr></thead><tbody>
      ${recs.map((r) => `<tr><td>${r.cover ? `<img src="${esc(r.cover)}" alt="">` : ""}<b>${esc(r.title)}</b><br><small>${esc(r.authors || "")}</small></td>
        <td>${shelfLabel[shelfOf(r)] || ""}${r.category ? `<br><small>${esc(r.category)}</small>` : ""}</td>
        <td>${readTo(r)}${r.totalPages ? ` / ${r.totalPages}` : ""}쪽${r.done ? " ✅" : ""}${minsOf(r) ? `<br>🎧 ${fmtMin(minsOf(r))}` : ""}</td>
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
    const same = allRecords.find((x) => x.id === r.id) || (r.isbn && allRecords.find((x) => x.kid === r.kid && x.isbn === r.isbn));
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
go(["port", "stats", "board"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "home");
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
let nickFirst = false;
function openNick(first = false) {
  nickFirst = first;
  $("nTitle").textContent = first ? "엄마 별명을 정해 주세요" : "엄마 별명 바꾸기";
  $("nIn").value = sync.myNick(); $("nErr").textContent = "";
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
    await sync.setNick(v);
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
        <small><span>${esc(p.nick)}</span><span>${ago(p.created_at)}</span>${p.views ? `<span>${ico("eye")} ${p.views}</span>` : ""}${p.nComments ? `<span>${ico("message")} ${p.nComments}</span>` : ""}${p.nLikes ? `<span>${ico("heart")} ${p.nLikes}</span>` : ""}</small>
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
  $("pTitle").textContent = "불러오는 중…"; $("pMeta").textContent = ""; $("pBody").textContent = ""; $("pPhotos").innerHTML = "";
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
  $("pMeta").innerHTML = `<button type="button" class="nick-link" data-u="${esc(p.user_id)}">${esc(p.nick)}</button> · ${ago(p.created_at)}${p.updated_at && Date.parse(p.updated_at) - Date.parse(p.created_at) > 60000 ? " · 고침" : ""} · 조회 ${p.views || 0}`;
}
function paintPost() {
  const p = postNow, mine = p.user_id === sync.myId(), adm = sync.amAdmin();
  $("pBoard").textContent = `${BOARDS[p.board] || ""}${p.pinned ? " · 공지" : ""}`;
  $("pTitle").textContent = p.title;
  paintMeta();
  $("pTopic").innerHTML = p.topic?.title ? topicCardHtml(p.topic) : "";
  fillTopicImgs($("pTopic"));
  $("pBody").textContent = p.body;
  $("pPhotos").innerHTML = p.photos?.length ? `<div class="ph-row big" data-paths="${esc(p.photos.join("|"))}"></div>` : "";
  fillPhotoRows($("pPhotos"));
  $("pLike").hidden = false;
  $("pLike").classList.toggle("on", p.liked);
  $("pLike").innerHTML = `${ico("heart")} 좋아요 ${p.nLikes || ""}`;
  $("pActions").innerHTML = [
    adm ? `<button type="button" data-a="pin">${p.pinned ? "공지 풀기" : "공지로 고정"}</button>` : "",
    mine ? `<button type="button" data-a="edit">고치기</button>` : "",
    mine || adm ? `<button type="button" data-a="del">지우기</button>` : "",
  ].join("");
  $("pCnt").textContent = p.comments.length || "";
  $("pComments").innerHTML = p.comments.map((c) => `<li><div><b>${esc(c.nick)}</b><small>${ago(c.created_at)}</small>
      ${c.user_id === sync.myId() || adm ? `<button type="button" class="x" data-c="${c.id}" aria-label="댓글 지우기">✕</button>` : ""}</div><p>${esc(c.body)}</p></li>`).join("")
    || `<li class="muted">첫 댓글을 남겨 보세요</li>`;
}
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
  const b = e.target.closest("[data-c]"); if (!b || !postNow) return;
  if (!confirm("이 댓글을 지울까요?")) return;
  try { await sync.deleteComment(b.dataset.c); boardLoaded = ""; openPost(postNow.id); }
  catch { toast("지우지 못했어요"); }
});
$("pCSend").addEventListener("click", async () => {
  const v = $("pCIn").value.trim(); if (!v || !postNow) return;
  if (!sync.myNick()) { openNick(false); return; }
  $("pCSend").disabled = true;
  try { await sync.addComment(postNow.id, v); $("pCIn").value = ""; boardLoaded = ""; await openPost(postNow.id); }
  catch { toast("댓글을 올리지 못했어요. 인터넷 연결을 확인해 주세요"); }
  $("pCSend").disabled = false;
});

// 글쓰기 · 고치기
let writing = null, wPhotos = []; // wPhotos: [{ path, url }] 또는 [{ file, url }]
function paintWPhotos() {
  $("pePhotoCount").textContent = `${wPhotos.length}/${MAX_PHOTOS}`;
  $("pePhotos").innerHTML = wPhotos.map((p, i) => `<span class="ph"><img src="${esc(p.url)}" alt=""><button type="button" data-rm="${i}" aria-label="사진 빼기">✕</button></span>`).join("");
  $("pePhotoAdd").hidden = wPhotos.length >= MAX_PHOTOS;
}
function openWrite(p = null) {
  if (!AUTH.user || AUTH.offline) { toast("게시판은 인터넷에 연결돼 있을 때 쓸 수 있어요"); return; }
  if (!sync.myNick()) { openNick(false); return; }
  writing = p;
  wPhotos.forEach((x) => x.file && URL.revokeObjectURL(x.url));
  wPhotos = (p?.photos || []).map((path) => ({ path, url: "" }));
  if (p?.photos?.length) sync.photoUrls(p.photos).then((urls) => { const m = new Map(p.photos.map((pa, i) => [pa, urls[i]])); wPhotos.forEach((x) => { if (x.path) x.url = m.get(x.path) || ""; }); paintWPhotos(); });
  const bd = p?.board || board;
  [...$("peBoard").children].forEach((x) => x.setAttribute("aria-checked", String(x.dataset.b === bd)));
  $("peTitle").value = p?.title || ""; $("peBody").value = p?.body || "";
  $("peSave").textContent = p ? "고치기" : "올리기";
  paintWPhotos();
  if (wTopic?.url) URL.revokeObjectURL(wTopic.url);
  wTopic = p?.topic?.title ? { ...p.topic } : null;
  paintWTopic();
  $("postEdit").showModal();
}
$("bWrite").addEventListener("click", () => openWrite());
$("peBoard").addEventListener("click", (e) => { const b = e.target.closest("[data-b]"); if (b) [...$("peBoard").children].forEach((x) => x.setAttribute("aria-checked", String(x === b))); });
$("peClose").addEventListener("click", () => {
  if (($("peTitle").value.trim() || $("peBody").value.trim()) && !writing && !confirm("쓰던 글을 버릴까요?")) return;
  $("postEdit").close();
});
$("pePhotoAdd").addEventListener("click", () => $("pePhotoFile").click());
$("pePhotoFile").addEventListener("change", () => {
  const files = [...$("pePhotoFile").files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
  const room = MAX_PHOTOS - wPhotos.length;
  if (files.length > room) toast(`사진은 ${MAX_PHOTOS}장까지 넣을 수 있어요`);
  for (const f of files.slice(0, room)) wPhotos.push({ file: f, url: URL.createObjectURL(f) });
  $("pePhotoFile").value = "";
  paintWPhotos();
});
$("pePhotos").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rm]"); if (!b) return;
  const [x] = wPhotos.splice(Number(b.dataset.rm), 1); if (x.file) URL.revokeObjectURL(x.url); paintWPhotos();
});
$("peSave").addEventListener("click", async () => {
  const title = $("peTitle").value.trim(), body = $("peBody").value.trim();
  const bd = [...$("peBoard").children].find((x) => x.getAttribute("aria-checked") === "true")?.dataset.b || "free";
  if (!title) { toast("제목을 적어 주세요"); $("peTitle").focus(); return; }
  $("peSave").disabled = true;
  try {
    const kept = wPhotos.filter((x) => x.path).map((x) => x.path);
    const fresh = wPhotos.filter((x) => x.file);
    const paths = [...kept];
    for (let i = 0; i < fresh.length; i++) {
      toast(`사진 올리는 중 ${i + 1}/${fresh.length}`, 60000);
      try { paths.push(await sync.uploadPhoto(await shrinkPhoto(fresh[i].file), "board")); } catch { /* 건너뜀 */ }
    }
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
    fresh.forEach((x) => URL.revokeObjectURL(x.url)); wPhotos = [];
    $("postEdit").close();
    toast(writing ? "글을 고쳤어요" : "글을 올렸어요");
    board = bd; boardLoaded = ""; renderBoard(true);
    openPost(id);
  } catch { toast("올리지 못했어요. 인터넷 연결을 확인해 주세요", 3500); }
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
let wTopic = null; // { type, title, cover?, by?, photo?(저장된 사진), file?, url?(새 사진 미리보기) }
function paintWTopic() {
  $("peTopic").innerHTML = wTopic
    ? `<div class="topic-pick">${topicCardHtml(wTopic)}<button type="button" class="x" id="peTopicRm" aria-label="글감 빼기">✕</button></div>`
    : `<button type="button" class="btn ghost topic-add" id="peTopicAdd">＋ 글감 붙이기</button>`;
  fillTopicImgs($("peTopic"));
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
        ${img ? "" : `<p>${esc((p.body || "").replace(/\s+/g, " ").slice(0, 70))}</p>`}
        <small>${esc(p.nick)} · 조회 ${p.views || 0}</small></button>`;
    }).join("");
    fillTopicImgs($("popRow"));
  } catch { popAt = 0; $("popWrap").hidden = true; }
}
$("popRow").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) openPost(b.dataset.id); });
$("popMore").addEventListener("click", () => go("board"));
$("postView").addEventListener("close", () => {
  if (!document.querySelector('.tab[data-tab="home"]').hidden) renderPopular(true); else popAt = 0;
  if ($("momPage").open && momNow) openMom(momNow.uid, true);
});

// ---------- 엄마 페이지 ----------
let momNow = null;
const momCache = new Map();
async function openMom(uid, refresh = false) {
  if (!AUTH.user || AUTH.offline || !uid) return;
  const me = uid === sync.myId();
  const known = momCache.get(uid);
  if (!refresh) {
    momNow = { uid, nick: known?.nick || (me ? sync.myNick() : ""), posts: [], data: null };
    $("mNick").textContent = momNow.nick || "불러오는 중…";
    $("mAv").textContent = (momNow.nick || " ").slice(0, 1).toUpperCase();
    $("mCount").textContent = ""; $("mKids").innerHTML = `<small class="muted">불러오는 중…</small>`;
    $("mTopics").innerHTML = ""; $("mPosts").innerHTML = `<li class="muted">불러오는 중…</li>`;
    $("momPage").showModal();
  }
  const [nick, data, posts] = await Promise.all([
    momNow.nick ? momNow.nick : sync.nickOf(uid).catch(() => ""),
    me ? null : prefetchPeek(uid),
    sync.postsBy(uid).catch(() => null),
  ]);
  if (momNow?.uid !== uid) return;
  momNow.nick = nick || "(알 수 없음)"; momNow.posts = posts || []; momNow.data = data;
  $("mNick").textContent = momNow.nick;
  $("mAv").textContent = momNow.nick.slice(0, 1).toUpperCase();
  const kl = me ? kids : data?.kids || [];
  $("mKids").innerHTML = kl.length
    ? kl.map((k) => `<button type="button" class="kid" data-k="${esc(k.id)}">${esc(k.nick)}${gradeOf(k) ? ` <small class="grade">${gradeOf(k)}</small>` : ""}</button>`).join("")
    : `<small class="muted">${me || data ? "아직 등록한 아이가 없어요." : "책장을 나만 보기로 해 둔 집이에요."}</small>`;
  const tops = topicGroups();
  $("mCount").textContent = posts ? `글 ${momNow.posts.length} · 글감 ${tops.length}` : "";
  const n = (t) => tops.filter((x) => tType(x.topic) === t).length;
  $("mTopics").innerHTML = tops.length
    ? Object.keys(TOPIC).filter(n).map((t) => `<button type="button" class="tchip" data-t="${t}">${ico(TOPIC[t][1])}${TOPIC[t][0]} <span>${n(t)}</span></button>`).join("")
    : `<small class="muted">아직 글감을 붙인 글이 없어요.</small>`;
  $("mTopicsAll").hidden = !tops.length;
  $("mPosts").innerHTML = !posts ? `<li class="muted">불러오지 못했어요. 인터넷 연결을 확인해 주세요.</li>`
    : momNow.posts.length ? momNow.posts.map((p) => `<li><button type="button" class="post-row" data-id="${p.id}">
        <b>${esc(p.title)}</b><small><span>${BOARDS[p.board] || ""}</span><span>${ago(p.created_at)}</span><span>${ico("eye")} ${p.views || 0}</span></small></button></li>`).join("")
    : `<li class="muted">아직 쓴 글이 없어요.</li>`;
}
$("mClose").addEventListener("click", () => { $("momPage").close(); momNow = null; });
$("mPosts").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) openPost(b.dataset.id); });
$("mKids").addEventListener("click", (e) => {
  const b = e.target.closest("[data-k]"); if (!b || !momNow) return;
  const { uid, data } = momNow;
  momNow = null;
  for (const id of ["topicsPage", "postView", "momPage"]) if ($(id).open) $(id).close();
  if (uid === sync.myId()) { setKid(b.dataset.k); go("home"); return; }
  if (!data) { toast("지금은 볼 수 없는 책장이에요 (나만 보기로 바뀌었을 수 있어요)", 3500); return; }
  enterPeek(data, b.dataset.k);
});
$("mTopics").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) openTopics(b.dataset.t); });
$("mTopicsAll").addEventListener("click", () => openTopics("all"));
$("pMeta").addEventListener("click", (e) => { const b = e.target.closest("[data-u]"); if (b) openMom(b.dataset.u); });

// 글감 모아보기
let tpType = "all", tpOpen = "";
function topicGroups() {
  const g = new Map();
  for (const p of momNow?.posts || []) {
    if (!p.topic?.title) continue;
    const key = `${tType(p.topic)}|${p.topic.title.trim().toLowerCase()}`;
    if (!g.has(key)) g.set(key, { key, topic: p.topic, posts: [] });
    g.get(key).posts.push(p);
  }
  return [...g.values()];
}
function openTopics(type) { tpType = type; tpOpen = ""; paintTopics(); $("topicsPage").showModal(); }
function paintTopics() {
  const all = topicGroups();
  $("tpTitle").textContent = `${momNow?.nick || ""}님의 글감`;
  $("tpTabs").innerHTML = [["all", "전체"], ...Object.entries(TOPIC).map(([k, v]) => [k, v[0]])]
    .map(([k, v]) => `<button type="button" data-t="${k}" class="${k === tpType ? "on" : ""}">${v}</button>`).join("");
  const list = tpType === "all" ? all : all.filter((x) => tType(x.topic) === tpType);
  $("tpCount").innerHTML = `<b>${list.length}</b>건`;
  $("tpGrid").innerHTML = list.length ? list.map((x) => `<button type="button" class="tp-item${x.key === tpOpen ? " open" : ""}" data-key="${esc(x.key)}">
      ${topicCover(x.topic, "tp-cover")}<span>${esc(x.topic.title)}</span>${x.posts.length > 1 ? `<small>글 ${x.posts.length}</small>` : ""}</button>
      ${x.key === tpOpen ? `<div class="tp-more">${x.posts.map((p) => `<button type="button" data-id="${p.id}">${esc(p.title)}</button>`).join("")}</div>` : ""}`).join("")
    : `<p class="muted">이 종류의 글감은 아직 없어요.</p>`;
  fillTopicImgs($("tpGrid"));
}
$("tpTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { tpType = b.dataset.t; tpOpen = ""; paintTopics(); } });
$("tpGrid").addEventListener("click", (e) => {
  const p = e.target.closest("[data-id]"); if (p) { openPost(p.dataset.id); return; }
  const b = e.target.closest("[data-key]"); if (!b) return;
  const g = topicGroups().find((x) => x.key === b.dataset.key); if (!g) return;
  if (g.posts.length === 1) openPost(g.posts[0].id);
  else { tpOpen = tpOpen === g.key ? "" : g.key; paintTopics(); }
});
$("tpClose").addEventListener("click", () => $("topicsPage").close());

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
  else if (PROFILE === null) setTimeout(() => { hideWelcome(); openNick(true); }, 900);
  else if (!kids.length) setTimeout(() => { hideWelcome(); openKids(true); }, 900);
  else { welcome.addEventListener("click", hideWelcome); setTimeout(hideWelcome, 1300); }
}
