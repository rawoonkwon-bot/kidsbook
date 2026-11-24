import { Scanner, warmUpDetector } from "./scanner.js";
import { lookupBook } from "./lookup.js";
import { toIsbn13 } from "./isbn.js";

const $ = (id) => document.getElementById(id);
const REC_KEY = "kbc:records:v1";
const BONUS = 50; // 독후활동 보너스 포인트
const STAMPS_PER_BOARD = 8;
const BOOK_CATS = ["문학", "자연과학", "사회과학", "역사", "예술", "언어", "기술과학", "철학", "종교", "총류", "기타"];
const SHELVES = { ko: "🇰🇷 한글책", en: "🔤 영어책", focus: "🎧 집중듣기" };
const shelfName = (k) => SHELVES[k].split(" ")[1];
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
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// ---------- 저장소 ----------
// 한 권 = 기록 1개. 여러 날 읽은 내용은 sessions [{from, to, day}] 로 쌓임
const readTo = (r) => Math.max(0, ...r.sessions.map((s) => s.to || 0));
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
  return r;
}
const uid = () => crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };

// ---------- 자녀 ----------
// 모든 기록은 자녀(kid)별로 저장. 화면에는 지금 고른 자녀의 기록만 보여 줌
const KIDS_KEY = "kbc:kids:v1", ACTIVE_KEY = "kbc:activeKid";
let kids = readJSON(KIDS_KEY, []);
let activeKid = localStorage.getItem(ACTIVE_KEY);
if (!kids.some((k) => k.id === activeKid)) activeKid = kids[0]?.id || null;
const saveKids = () => {
  localStorage.setItem(KIDS_KEY, JSON.stringify(kids));
  if (activeKid) localStorage.setItem(ACTIVE_KEY, activeKid); else localStorage.removeItem(ACTIVE_KEY);
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
  localStorage.setItem(REC_KEY, JSON.stringify(allRecords));
};
viewRecords();
saveRecords();

// ---------- 계산 ----------
const sessionPages = (s) => (s.from && s.to ? Math.max(0, s.to - s.from + 1) : s.to || 0);
const pagesOf = (r) => r.sessions.reduce((a, s) => a + sessionPages(s), 0);
const minsOf = (r) => r.sessions.reduce((a, s) => a + (s.minutes || 0), 0);
const pointsOf = (r) => pagesOf(r) + (r.bonus ? BONUS : 0);
const totalPoints = () => records.reduce((a, r) => a + pointsOf(r), 0);
const pct = (r) => (r.totalPages ? Math.min(100, Math.round((readTo(r) / r.totalPages) * 100)) : 0);
const sessionText = (s) => (s.from && s.to ? `${s.from}~${s.to}쪽` : s.to ? `~${s.to}쪽` : "쪽수 없음") + (s.minutes ? ` · ${fmtMin(s.minutes)}` : "");
const firstDay = (r) => r.sessions.map((s) => s.day).sort()[0];
const lastDay = (r) => r.sessions.map((s) => s.day).sort().at(-1);
function progressText(r) {
  const to = readTo(r);
  if (r.done) return `✅ 다 읽었어요!${r.totalPages ? ` (${r.totalPages}쪽)` : ""}`;
  if (!to) return "";
  return r.totalPages ? `진도율 ${pct(r)}% (${to} / ${r.totalPages}쪽)` : `${to}쪽까지 읽었어요`;
}
const hasHangul = (t) => /[가-힣]/.test(t || "");
const shelfOf = (r) => r.shelf || (hasHangul(r.title) ? "ko" : "en");
const stampList = () => records.filter((r) => r.done).sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0));

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
  if (tab === "stats") renderStats();
  if (tab === "port") renderCalendar();
  window.scrollTo(0, 0);
  history.replaceState(null, "", tab === "home" ? location.pathname : `#${tab}`);
}
document.querySelectorAll(".tabbar button").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));

// ---------- 홈 ----------
const ringSvg = (frac) => {
  const r = 36, c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="${r}" fill="none" stroke="#E7E8EE" stroke-width="7"/>
    ${frac > 0 ? `<circle cx="42" cy="42" r="${r}" fill="none" stroke="#9DBE10" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c * Math.min(1, frac)).toFixed(1)} ${c.toFixed(1)}"/>` : ""}</svg>`;
};

const cardHtml = (r) => `
    <li data-id="${r.id}" tabindex="0" role="button" aria-label="${esc(r.title)} 기록 보기" title="${esc(r.title)}">
      ${imgOr(r.cover, r.title, "cover")}
      ${r.done ? `<span class="done-badge" aria-label="다 읽음">✓</span>` : r.totalPages ? `<div class="pbar"><i style="width:${pct(r)}%"></i></div>` : ""}
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
  filter.innerHTML = `<option value="all">전체 (${records.length})</option>` +
    months.map((m) => `<option value="${m}">${m.replace("-", "년 ")}월 (${records.filter((r) => inMonth(r, m)).length})</option>`).join("");
  filter.value = months.includes(cur) ? cur : "all";
  const list = filter.value === "all" ? records : records.filter((r) => inMonth(r, filter.value));
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

  const { book, ms, cached } = await lookupBook(isbn, { needDescription: true });
  if (!sheet || sheet.isbn !== isbn) return;
  sheet.book = book;
  const parts = [];
  if (scanInfo) parts.push(`인식 ${(scanInfo.ms / 1000).toFixed(2)}초`);
  parts.push(cached ? "저장된 정보" : `조회 ${(ms / 1000).toFixed(2)}초${book ? ` · ${book.source}` : ""}`);
  $("sTiming").textContent = parts.join(" · ");
  $("sOk").disabled = false;

  if (!book && !existing) {
    $("sTitle").textContent = "책 정보를 찾지 못했어요";
    $("sAuthor").textContent = "셀프등록으로 제목과 쪽수를 직접 적어 주세요";
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
    $("sMine").textContent = existing.done ? "📚 내 책장에 있는, 다 읽은 책이에요" : `📚 읽고 있는 책이에요 · ${progressText(existing) || "쪽수 기록 없음"}`;
    $("sOk").textContent = existing.done ? "기록 보기" : "이어서 기록하기";
  }
}
$("sDesc").addEventListener("click", () => $("sDesc").classList.toggle("open"));
$("sSelf").addEventListener("click", () => $("scanSheet").close("self"));
$("scanSheet").addEventListener("close", () => {
  const v = $("scanSheet").returnValue;
  const s = sheet; sheet = null;
  if (!s || (v !== "ok" && v !== "self")) return; // ✕ = 검색만 하고 끝
  if (s.existing) { s.existing.done && v === "ok" ? openView(s.existing.id) : openRecord({ existing: s.existing }); return; }
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

function openRecord({ existing = null, isbn = null, book = null, self = false }) {
  rec = { existing, isbn: existing?.isbn || isbn, book, self };
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
  $("rMeta").textContent = [publisher && `(출판사) ${publisher}`, !self && authors && `(작가) ${authors}`, category && `(분야) ${category}`, total && `${total} pages`]
    .filter(Boolean).join("\n") || (rec.isbn ? `ISBN ${rec.isbn}` : "");
  $("rDesc").textContent = desc; $("rDesc").classList.remove("open");
  $("rDescHead").hidden = !desc;

  chosenShelf = existing ? shelfOf(existing) : preferShelf || (title ? (hasHangul(title) ? "ko" : "en") : (rec.isbn?.startsWith("97911") || rec.isbn?.startsWith("97889") ? "ko" : "en"));
  paintShelf();
  rDay = returnDay || localDay(); paintDate();

  const prev = existing ? readTo(existing) : 0;
  $("soFar").hidden = !prev;
  $("soFar").textContent = prev ? `지난번까지 ${prev}쪽 읽었어요 → 오늘은 ${prev + 1}쪽부터` : "";
  $("rTotal").value = total || "";
  $("rTo").value = ""; $("rMin").value = ""; $("rHour").value = "";
  $("rTo").placeholder = prev ? `${prev + 1}쪽부터 몇 쪽까지?` : "몇 쪽까지";
  // 새 책이고 전체 쪽수를 알면 '다 읽은 책'을 기본으로 (한 번에 다 읽는 그림책이 많아서)
  $("rDone").checked = !existing && !!total;
  $("pagesLabel").textContent = prev ? "오늘 몇 쪽까지 읽었나요? / (전체 페이지)" : "읽은 페이지 / (전체 페이지)";
  syncDone();
  $("rTiming").textContent = rec.isbn ? `ISBN ${rec.isbn}` : "";
  $("recordPage").showModal();
  $("recordPage").scrollTop = 0;
  if (self) setTimeout(() => $("rTitle").focus(), 50);
}
$("rDesc").addEventListener("click", () => $("rDesc").classList.toggle("open"));

function saveRecord() {
  if (!rec) return;
  const r0 = rec.existing;
  const prev = r0 ? readTo(r0) : 0;
  const total = parseInt($("rTotal").value, 10) || null;
  const done = $("rDone").checked;
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
    r.sessions.push(session);
    r.shelf = chosenShelf;
    if (total) r.totalPages = total;
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
      done: false, score: null, note: "", bonus: false,
      date: new Date().toISOString(),
    };
    records.unshift(r);
  }
  const gained = to - prev;
  const finished = !!(r.totalPages && to >= r.totalPages);
  if (finished && !r.done) { r.done = true; r.doneAt = Date.now(); r.doneDay = rDay; }
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
    if (!r.bonus) { r.bonus = true; extra = BONUS; }
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
    const r = on[i];
    if (!r) return `<div class="stamp" aria-label="빈 칸">📖</div>`;
    return `<div class="stamp on${r.id === newId ? " new" : ""}" title="${esc(r.title)}">${r.cover ? `<img src="${esc(r.cover)}" alt="">` : ""}</div>`;
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
  $("vMeta").textContent = [SHELVES[shelfOf(r)], r.totalPages && `${r.totalPages}쪽`, minsOf(r) && `🎧 ${fmtMin(minsOf(r))}`, `${pointsOf(r)}점`].filter(Boolean).join(" · ");
  $("vProgress").innerHTML = progressText(r)
    ? `<b>${esc(progressText(r))}</b>${r.totalPages ? `<div class="bar"><i style="width:${pct(r)}%"></i></div>` : ""}` : "";
  $("vSessions").innerHTML = [...r.sessions].sort((a, b) => a.day.localeCompare(b.day))
    .map((s) => `<li><span>${prettyDay(s.day)}</span><b>${sessionText(s)}</b></li>`).join("");
  $("vMore").hidden = r.done;
  $("vActivity").hidden = !(r.done && !r.bonus);
  $("vScore").textContent = r.score ? `${"★".repeat(r.score)}${"☆".repeat(5 - r.score)}  ${r.score}점` : "주지 않았어요";
  $("vNote").textContent = r.note || "적지 않았어요";
  $("vCat").value = BOOK_CATS.includes(r.category) ? r.category : "";
  $("vTotalRow").hidden = !!r.totalPages;
  $("vTotal").value = "";
}
$("vCat").addEventListener("change", () => { if (!viewing) return; viewing.category = $("vCat").value; saveRecords(); render(); toast("분야를 바꿨어요"); });
$("vTotalSave").addEventListener("click", () => {
  const t = parseInt($("vTotal").value, 10);
  if (!viewing || !t) return;
  viewing.totalPages = t;
  if (readTo(viewing) >= t && !viewing.done) { viewing.done = true; viewing.doneAt = Date.now(); }
  saveRecords(); render(); fillView(viewing);
  toast(`전체 ${t}쪽으로 저장했어요`);
});
$("viewDialog").addEventListener("close", () => {
  const v = $("viewDialog").returnValue;
  const r = viewing; viewing = null;
  if (!r) return;
  if (v === "more") openRecord({ existing: r });
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
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(allJournal));
};
viewJournal();
const writeAll = () => {
  localStorage.setItem(REC_KEY, JSON.stringify(allRecords));
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(allJournal));
};

// 카테고리: 사용자가 편집 가능. kind = book(책장) · focus(책장+시간) · time(한 것+시간) · note(메모만)
const CATS_KEY = "kbc:cats:v1";
const DEFAULT_CATS = [
  { key: "ko", icon: "📕", name: "한글책", kind: "book" },
  { key: "en", icon: "📘", name: "영어책", kind: "book" },
  { key: "listen", icon: "🎧", name: "흘려듣기", kind: "time" },
  { key: "focus", icon: "👂", name: "집중듣기", kind: "focus" },
  { key: "memo", icon: "📝", name: "메모", kind: "note" },
];
const LEGACY_CATS = [
  { key: "math", icon: "➗", name: "수학", kind: "time" },
  { key: "etc", icon: "⭐", name: "기타", kind: "time" },
];
const PH = { listen: "예: Peppa Pig 3화", focus: "예: Magic Tree House 1권", math: "예: 연산 문제집 12~15쪽", etc: "예: 피아노 연습" };
function decorate(c) {
  const d = { ...c };
  if (c.kind === "book") d.book = true;
  if (c.kind === "focus") d.hybrid = true;
  if (c.kind === "time" || c.kind === "focus") {
    const listen = c.key === "listen" || c.key === "focus";
    Object.assign(d, { what: listen ? "무엇을 들었나요?" : "무엇을 했나요?", whatPh: PH[c.key] || "예: 오늘 한 것", amount: "얼마나 했나요?", unit: "분" });
  }
  if (c.kind === "note") Object.assign(d, { text: c.key === "memo" ? "메모" : "내용", textPh: "오늘 있었던 일, 칭찬할 점 등" });
  return d;
}
let catList = readJSON(CATS_KEY, null);
if (!Array.isArray(catList)) {
  // 처음 한 번: 기본 5개 + 이미 기록이 있는 예전 카테고리(수학·기타)
  catList = [...DEFAULT_CATS];
  for (const c of LEGACY_CATS) if (allJournal.some((j) => j.cat === c.key)) catList.splice(catList.length - 1, 0, c);
  localStorage.setItem(CATS_KEY, JSON.stringify(catList));
}
// 기록은 있는데 목록에 없는 예전 카테고리는 다시 넣어 둠 (기록이 안 보이게 되는 일 방지)
for (const c of LEGACY_CATS) {
  if (!catList.some((x) => x.key === c.key) && allJournal.some((j) => j.cat === c.key)) {
    catList.splice(Math.max(0, catList.findIndex((x) => x.key === "memo")), 0, { ...c });
    localStorage.setItem(CATS_KEY, JSON.stringify(catList));
  }
}
const saveCats = () => localStorage.setItem(CATS_KEY, JSON.stringify(catList));
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
    html += `<button type="button" class="${cls}" data-day="${day}" ${day > today || out ? "disabled" : ""} aria-label="${prettyDay(day)}${cats.length ? ` · ${cats.map((c) => c.name).join(", ")}` : ""}">
      ${d.getDate()}${cats.length ? `<span class="dot">${cats.slice(0, 3).map((c) => c.icon).join("")}</span>` : ""}</button>`;
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
    return `<button type="button" data-cat="${c.key}" class="${dayPanel === c.key ? "on" : ""}"><span class="ic">${c.icon}</span>${c.name}${n ? `<span class="cnt">${n}</span>` : ""}</button>`;
  }).join("");

  let html = "";
  if (dayPanel) {
    const c = CAT[dayPanel];
    const ongoing = records.filter((r) => shelfOf(r) === dayPanel && !r.done);
    html += `<div class="day-actions">
        <button type="button" class="btn lime" data-act="scan">📷 책 스캔</button>
        <button type="button" class="btn ghost" data-act="isbn" style="background:var(--soft)">ISBN 입력</button>
        ${c.hybrid ? `<button type="button" class="btn ghost" data-act="entry" style="background:var(--soft)">✏️ 직접 적기</button>` : ""}
      </div>`;
    html += ongoing.length ? `<small>읽고 있는 ${c.name} (누르면 이 날 읽은 쪽수를 기록해요)</small>` +
      ongoing.map((r) => `<div class="day-item link" data-more="${r.id}">
        ${r.cover ? `<img src="${esc(r.cover)}" alt="">` : `<span>${c.icon}</span>`}
        <div class="grow"><b>${esc(r.title)}</b><small>${progressText(r) || "아직 쪽수 기록 없음"}</small></div><span>➕</span></div>`).join("")
      : `<small>읽고 있는 ${c.name} 책이 없어요. 책 스캔으로 새 책을 기록해 보세요.</small>`;
  } else {
    for (const c of CATS) {
      if (c.book || c.hybrid) {
        for (const { r, s } of booksOn(day, c.key)) {
          html += `<div class="day-item link" data-view="${r.id}">
            ${r.cover ? `<img src="${esc(r.cover)}" alt="">` : `<span>${c.icon}</span>`}
            <div class="grow"><b>${c.icon} ${esc(r.title)}</b><small>${sessionText(s)}</small></div></div>`;
        }
      }
      if (!c.book) {
        for (const j of journalOn(day, c.key)) {
          const sub = [j.minutes ? fmtMin(j.minutes) : "", j.text || ""].filter(Boolean).join(" · ");
          html += `<div class="day-item"><span>${c.icon}</span>
            <div class="grow"><b>${esc(j.what || c.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>
            <button type="button" class="x" data-del="${j.id}" aria-label="지우기">✕</button></div>`;
        }
      }
    }
    if (!html) html = `<small style="text-align:center">아직 이 날의 기록이 없어요. 위 카테고리를 눌러 기록해 보세요.</small>`;
  }
  $("dayList").innerHTML = html;
}
$("dayCats").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-cat]"); if (!b) return;
  const c = CAT[b.dataset.cat];
  if (c.book || c.hybrid) { dayPanel = dayPanel === c.key ? null : c.key; fillDay(openDayKey); return; }
  openEntry(c.key);
});
$("dayList").addEventListener("click", (e) => {
  const t = e.target.closest("[data-act],[data-more],[data-view],[data-del]"); if (!t) return;
  const day = openDayKey;
  if (t.dataset.del) {
    if (!confirm("이 기록을 지울까요?")) return;
    journal = journal.filter((j) => j.id !== t.dataset.del); saveJournal(); render(); return;
  }
  // 다른 창을 열기 전에 날짜 시트를 잠시 닫고, 끝나면 다시 돌아옴
  $("dayDialog").close("away"); returnDay = day;
  preferShelf = dayPanel;
  if (t.dataset.act === "scan") openScanner();
  else if (t.dataset.act === "isbn") openManual();
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
function openEntry(cat) {
  const c = CAT[cat]; entryCat = cat;
  $("eTitle").textContent = `${c.icon} ${c.name} · ${prettyDay(openDayKey)}`;
  $("eWhatWrap").hidden = !c.what; $("eWhatLabel").textContent = c.what || ""; $("eWhat").placeholder = c.whatPh || ""; $("eWhat").value = "";
  $("eAmountWrap").hidden = !c.amount; $("eAmountLabel").textContent = (c.amount || "").replace("몇 분", "얼마나"); $("eUnit").textContent = c.unit || ""; $("eAmount").value = ""; $("eHour").value = "";
  $("eTextWrap").hidden = false; $("eTextLabel").textContent = c.text || "한 줄 메모 (선택)"; $("eText").placeholder = c.textPh || ""; $("eText").value = "";
  $("eText").rows = c.text ? 5 : 2;
  $("dayDialog").close("away"); returnDay = openDayKey || returnDay;
  $("entryDialog").showModal();
}
$("entryDialog").addEventListener("close", () => {
  if ($("entryDialog").returnValue !== "save" || !entryCat) return;
  const what = $("eWhat").value.trim(), text = $("eText").value.trim(), minutes = ((parseInt($("eHour").value, 10) || 0) * 60 + (parseInt($("eAmount").value, 10) || 0)) || null;
  if (!what && !text && !minutes) { toast("내용을 적어 주세요"); return; }
  journal.push({ id: crypto.randomUUID?.() || String(Date.now()), day: returnDay || localDay(), cat: entryCat, what, minutes, text });
  saveJournal(); render();
  toast(`${CAT[entryCat].icon} ${CAT[entryCat].name} 기록했어요`);
  entryCat = null;
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
  const pages = records.reduce((a, r) => a + pagesOf(r), 0);
  const done = records.filter((r) => r.done).length;
  const focusMins = records.reduce((a, r) => a + minsOf(r), 0) + journal.filter((j) => j.cat === "focus").reduce((a, j) => a + (j.minutes || 0), 0);
  const recDays = new Set([...records.flatMap((r) => r.sessions.map((s) => s.day)), ...journal.map((j) => j.day)]).size;
  $("statTiles").innerHTML = [
    ["읽은 책", records.length, "권"], ["끝까지 읽은 책", done, "권"],
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

// ---------- 자녀 바 ----------
function renderKids() {
  $("kidBar").hidden = !kids.length;
  $("kidBar").innerHTML = kids.map((k) => `<button type="button" class="kid${k.id === activeKid ? " on" : ""}" data-kid="${k.id}">${esc(k.nick)}</button>`).join("") +
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
  kidDraft = kids.map((k) => ({ ...k }));
  if (!kidDraft.length) kidDraft.push({ id: uid(), nick: "" });
  $("kTitle").textContent = first ? "반가워요! 자녀를 등록해 주세요 🍌" : "자녀 관리";
  $("kCancel").hidden = first;
  paintKids();
  $("kidsDialog").showModal();
  if (first) setTimeout(() => $("kList").querySelector("input")?.focus(), 50);
}
function syncKids() { $("kList").querySelectorAll("input").forEach((inp, i) => (kidDraft[i].nick = inp.value)); }
function paintKids() {
  $("kList").innerHTML = kidDraft.map((k, i) => `<li><input class="sub-input" value="${esc(k.nick)}" maxlength="10" placeholder="닉네임 (예: 시운)" aria-label="${i + 1}번째 자녀 닉네임" />
    ${kidDraft.length > 1 ? `<button type="button" class="x" data-rm="${i}" aria-label="${esc(k.nick || "이 자녀")} 지우기">✕</button>` : ""}</li>`).join("");
}
$("kList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rm]"); if (!b) return;
  syncKids(); kidDraft.splice(Number(b.dataset.rm), 1); paintKids();
});
$("kList").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("kSave").click(); } });
$("kAdd").addEventListener("click", () => {
  syncKids(); kidDraft.push({ id: uid(), nick: "" }); paintKids();
  const ins = $("kList").querySelectorAll("input"); ins[ins.length - 1].focus();
});
$("kidsDialog").addEventListener("cancel", (e) => { if (kidsFirst) e.preventDefault(); });
$("kSave").addEventListener("click", () => {
  syncKids();
  const nicks = kidDraft.map((k) => k.nick.trim());
  if (nicks.some((n) => !n)) { toast("닉네임을 모두 적어 주세요"); return; }
  if (new Set(nicks).size !== nicks.length) { toast("같은 닉네임이 있어요"); return; }
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
  kids = kidDraft.map((k) => ({ id: k.id, nick: k.nick.trim() }));
  // 자녀 등록 전에 만든 기록은 첫째 자녀에게
  for (const x of [...allRecords, ...allJournal]) if (!x.kid) x.kid = kids[0].id;
  writeAll();
  if (!kids.some((k) => k.id === activeKid)) activeKid = kids[0].id;
  $("kidsDialog").close("saved");
  setKid(activeKid);
  toast(kidsFirst ? `${kids.map((k) => k.nick).join(", ")} 등록 완료! 🎉` : "자녀 정보를 저장했어요");
});

// ---------- 카테고리 편집 ----------
const EMOJIS = ["⭐", "➗", "🎹", "🎻", "⚽", "🏊", "🎨", "✏️", "🧩", "🔬", "🌏", "🈶", "🧘", "🏃", "🎵", "💻", "📖", "🗣️"];
let catDraft = [], newKind = "time";
const LOCKED = (c) => c.kind === "book" || c.kind === "focus";
const KIND_NAME = { book: "책장", focus: "책장+시간", time: "한 것+시간", note: "메모" };
$("cEmoji").innerHTML = EMOJIS.map((e) => `<button type="button" data-e="${e}" aria-label="${e} 고르기">${e}</button>`).join("");
$("cEmoji").addEventListener("click", (e) => { const b = e.target.closest("[data-e]"); if (b) $("cNewIcon").value = b.dataset.e; });
$("cNewKind").addEventListener("click", (e) => {
  const b = e.target.closest("[data-kind]"); if (!b) return;
  newKind = b.dataset.kind;
  [...$("cNewKind").children].forEach((x) => x.setAttribute("aria-checked", String(x === b)));
});
function openCats() {
  catDraft = catList.map((c) => ({ ...c }));
  $("cNewIcon").value = ""; $("cNewName").value = "";
  paintCats();
  $("catsDialog").showModal();
}
function syncCats() {
  $("cList").querySelectorAll("li").forEach((li, i) => {
    catDraft[i].icon = li.querySelector(".ic-in").value.trim() || catDraft[i].icon;
    catDraft[i].name = li.querySelector(".nm-in").value;
  });
}
function paintCats() {
  const last = catDraft.length - 1;
  $("cList").innerHTML = catDraft.map((c, i) => `<li data-i="${i}" class="${c.hidden ? "off" : ""}" title="${KIND_NAME[c.kind] || ""}">
    <input class="ic-in" value="${esc(c.icon)}" maxlength="4" aria-label="${esc(c.name)} 아이콘" />
    <input class="nm-in" value="${esc(c.name)}" maxlength="8" aria-label="카테고리 이름" />
    <button type="button" data-mv="-1" aria-label="위로" ${i ? "" : "disabled"}>▲</button>
    <button type="button" data-mv="1" aria-label="아래로" ${i < last ? "" : "disabled"}>▼</button>
    <button type="button" data-hide aria-label="${c.hidden ? "보이기" : "숨기기"}">${c.hidden ? "🙈" : "👁"}</button>
    ${LOCKED(c) ? `<span class="lock" title="책장과 연결돼 있어서 숨기기만 돼요">🔒</span>` : `<button type="button" data-rm aria-label="${esc(c.name)} 삭제">🗑</button>`}
  </li>`).join("");
}
$("cList").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  syncCats();
  const i = Number(b.closest("li").dataset.i);
  if (b.dataset.mv) { const j = i + Number(b.dataset.mv); [catDraft[i], catDraft[j]] = [catDraft[j], catDraft[i]]; }
  else if (b.hasAttribute("data-hide")) catDraft[i].hidden = !catDraft[i].hidden;
  else if (b.hasAttribute("data-rm")) catDraft.splice(i, 1);
  paintCats();
});
$("cAdd").addEventListener("click", () => {
  syncCats();
  const name = $("cNewName").value.trim();
  if (!name) { toast("새 카테고리 이름을 적어 주세요"); $("cNewName").focus(); return; }
  if (catDraft.some((c) => c.name === name)) { toast("같은 이름이 있어요"); return; }
  catDraft.push({ key: "c_" + uid().replace(/-/g, "").slice(0, 10), icon: $("cNewIcon").value.trim() || "⭐", name, kind: newKind });
  $("cNewIcon").value = ""; $("cNewName").value = "";
  paintCats();
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
  const last = localStorage.getItem(EXPORT_KEY);
  $("lastExport").textContent = last ? `마지막으로 내려받은 날: ${last}` : "모든 자녀의 기록을 파일 하나(ZIP)로 저장해요";
  $("settingsDialog").showModal();
}
$("gearBtn").addEventListener("click", openSettings);
$("setKids").addEventListener("click", () => { $("settingsDialog").close("away"); openKids(false); });
$("setCats").addEventListener("click", () => { $("settingsDialog").close("away"); openCats(); });
$("setExport").addEventListener("click", () => { exportAll(); });
$("setImport").addEventListener("click", () => $("importFile").click());

// ---------- 내 기록 내려받기 / 다시 올리기 ----------
const BACKUP_FORMAT = "banana-bookcode-backup", BACKUP_VERSION = 1;
const ABOUT = {
  "이 파일은": "바나나북코드(아이 독서기록 앱)의 모든 기록을 담은 보관용 파일이에요. 앱의 '설정 → 기록 파일 다시 올리기'로 복원할 수 있어요.",
  kids: "자녀 목록. id, nick(닉네임)",
  categories: "포트폴리오 카테고리. kind: book=책장(한글책/영어책), focus=집중듣기(책+시간), time=한 것+시간, note=메모. hidden=숨김",
  records: "책 기록(책 한 권 = 1개). kid=자녀 id, shelf: ko 한글책 / en 영어책 / focus 집중듣기. sessions=읽은 날(day, YYYY-MM-DD)마다 읽은 쪽(from~to)과 집중듣기 시간(minutes, 분). totalPages=전체 쪽수, done=끝까지 읽음, score=별점(1~5), note=독후활동 글, bonus=독후활동 포인트(+50) 받음, category=분야",
  journal: "포트폴리오 하루 기록. kid=자녀 id, day=날짜, cat=카테고리 key, what=한 것, minutes=시간(분), text=메모",
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
      const c = catOf[j.cat] || { icon: "•", name: j.cat };
      add(j.day, `<li>${c.icon} ${esc(c.name)}${j.what ? ` · <b>${esc(j.what)}</b>` : ""}${j.minutes ? ` · ${fmtMin(j.minutes)}` : ""}${j.text ? `<div class="memo">${esc(j.text)}</div>` : ""}</li>`);
    }
    const pages = recs.reduce((a, r) => a + pagesOf(r), 0), pts = recs.reduce((a, r) => a + pointsOf(r), 0);
    return `<section><h2>🍌 ${esc(k.nick)}</h2>
      <p class="sum">책 ${recs.length}권 · 끝까지 읽은 책 ${recs.filter((r) => r.done).length}권 · ${pages.toLocaleString()}쪽 · 독서 포인트 ${pts.toLocaleString()}점</p>
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
  localStorage.setItem(EXPORT_KEY, localDay());
  $("lastExport").textContent = `마지막으로 내려받은 날: ${localDay()}`;
  toast("💾 기록 파일을 내려받았어요");
}
function mergeBackup(d) {
  saveRecords(); saveJournal();
  const kidMap = {}, n = { k: 0, c: 0, r: 0, s: 0, j: 0 };
  for (const k of d.kids || []) {
    const same = kids.find((x) => x.id === k.id) || kids.find((x) => x.nick === k.nick);
    if (same) kidMap[k.id] = same.id;
    else { kids.push({ id: k.id || uid(), nick: k.nick || "자녀" }); kidMap[k.id] = kids.at(-1).id; n.k++; }
  }
  if (!kids.length) kids.push({ id: uid(), nick: "자녀" });
  const fallback = activeKid && kids.some((k) => k.id === activeKid) ? activeKid : kids[0].id;
  const kidOf = (id) => { const m = kidMap[id] || id; return kids.some((k) => k.id === m) ? m : fallback; };
  for (const c of d.categories || []) {
    if (c?.key && !catList.some((x) => x.key === c.key)) { catList.push({ key: c.key, icon: c.icon || "⭐", name: c.name || "카테고리", kind: c.kind || "time", hidden: !!c.hidden }); n.c++; }
  }
  for (const r0 of d.records || []) {
    if (!r0?.title) continue;
    const r = migrate({ ...r0, sessions: (r0.sessions || []).map((s) => ({ ...s })) });
    r.kid = kidOf(r0.kid); r.id = r.id || uid();
    const same = allRecords.find((x) => x.id === r.id) || (r.isbn && allRecords.find((x) => x.kid === r.kid && x.isbn === r.isbn));
    if (!same) { allRecords.push(r); n.r++; n.s += r.sessions.length; continue; }
    const key = (s) => `${s.day}|${s.from}|${s.to}`;
    const have = new Set(same.sessions.map(key));
    for (const s of r.sessions) if (!have.has(key(s))) { same.sessions.push(s); n.s++; }
    for (const f of ["score", "note", "category", "totalPages", "cover", "description", "authors", "publisher"]) if (!same[f] && r[f]) same[f] = r[f];
    if (r.bonus) same.bonus = true;
    if (r.done && !same.done) { same.done = true; same.doneAt = r.doneAt || Date.now(); }
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
go(["port", "stats"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "home");
warmUpDetector();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
if (!kids.length) openKids(true);
