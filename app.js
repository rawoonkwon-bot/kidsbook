import { Scanner, warmUpDetector } from "./scanner.js";
import { lookupBook } from "./lookup.js";
import { toIsbn13 } from "./isbn.js";

const $ = (id) => document.getElementById(id);
const REC_KEY = "kbc:records:v1";
const SCORES = [5, 4, 3, 2, 1];
const MODE_LABEL = { search: "🔍 책 검색", record: "📚 책 기록" };
let mode = "record"; // 지금 스캔/입력이 어느 박스에서 시작됐는지

// ---------- 날짜 (한국 시간 기준 YYYY-MM-DD) ----------
const localDay = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localDay(d); };
const prettyDay = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  const w = "일월화수목금토"[new Date(y, m - 1, d).getDay()];
  const tag = day === daysAgo(0) ? " (오늘)" : day === daysAgo(1) ? " (어제)" : day === daysAgo(2) ? " (그저께)" : "";
  return `${m}월 ${d}일 ${w}${tag}`;
};

// ---------- 저장소 ----------
// 한 권 = 기록 1개, 여러 날 읽은 내용은 sessions [{from, to, day}] 로 쌓임
function migrate(r) {
  if (!r.sessions) {
    const day = r.date ? localDay(new Date(r.date)) : localDay();
    r.sessions = (r.pageFrom || r.pageTo) ? [{ from: r.pageFrom || null, to: r.pageTo || null, day }] : [{ from: null, to: null, day }];
    delete r.pageFrom; delete r.pageTo;
  }
  return r;
}
const loadRecords = () => { try { return (JSON.parse(localStorage.getItem(REC_KEY)) || []).map(migrate); } catch { return []; } };
const saveRecords = (r) => localStorage.setItem(REC_KEY, JSON.stringify(r));
let records = loadRecords();
saveRecords(records);

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

// 날짜 입력 + 오늘/어제/그저께 버튼
function setupDate(inputId) {
  const input = $(inputId);
  const chips = document.querySelector(`.date-chips[data-for="${inputId}"]`);
  const paint = () => [...chips.children].forEach((b) => b.classList.toggle("on", daysAgo(Number(b.dataset.ago)) === input.value));
  chips.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    input.value = daysAgo(Number(b.dataset.ago)); paint();
  });
  input.addEventListener("input", paint);
  return (day) => { input.max = localDay(); input.value = day || localDay(); paint(); };
}
const resetBDate = setupDate("bDate");
const resetMDate = setupDate("mDate");
const pickDay = (id) => $(id).value || localDay();

// ---------- 쪽수 계산 ----------
const readTo = (r) => Math.max(0, ...r.sessions.map((s) => s.to || 0));
const sessionText = (s) => (s.from && s.to ? `${s.from}~${s.to}쪽` : s.to ? `~${s.to}쪽` : s.from ? `${s.from}쪽부터` : "쪽수 없음");
const lastDay = (r) => r.sessions.map((s) => s.day).sort().at(-1);
function progressText(r) {
  const to = readTo(r);
  if (!to) return "";
  if (r.totalPages) return to >= r.totalPages ? `✅ 다 읽었어요! (${r.totalPages}쪽)` : `${to} / ${r.totalPages}쪽`;
  return `${to}쪽까지 읽었어요`;
}
const pct = (r) => (r.totalPages ? Math.min(100, Math.round((readTo(r) / r.totalPages) * 100)) : 0);
const parsePages = (fromId, toId) => {
  let from = parseInt($(fromId).value, 10) || null;
  let to = parseInt($(toId).value, 10) || null;
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
};

// ---------- 책장 ----------
// 한글책/영어책 구분: 기록할 때 고른 책장, 없으면(예전 기록) 제목에 한글이 있는지로 판단
const hasHangul = (t) => /[가-힣]/.test(t || "");
const shelfOf = (r) => r.shelf || (hasHangul(r.title) ? "ko" : "en");
const cardHtml = (r) => `
    <li data-id="${r.id}" tabindex="0" role="button" aria-label="${esc(r.title)} 기록 보기">
      ${r.cover ? `<img class="cover" src="${esc(r.cover)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cover',textContent:'📘'}))">` : `<div class="cover">📘</div>`}
      ${r.score ? `<span class="s score-badge">★${r.score}</span>` : r.sticker ? `<span class="s">${r.sticker}</span>` : ""}
      <div class="t">${esc(r.title)}</div>
      ${r.totalPages ? `<div class="bar" title="${readTo(r)}/${r.totalPages}쪽"><i style="width:${pct(r)}%"></i></div>` : `<div class="bar none" title="전체 쪽수를 모르는 책"></div>`}
    </li>`;

function render() {
  const filter = $("monthFilter");
  const months = [...new Set(records.flatMap((r) => r.sessions.map((s) => s.day.slice(0, 7))))].sort().reverse();
  const inMonth = (r, m) => r.sessions.some((s) => s.day.startsWith(m));
  const cur = filter.value || "all";
  filter.innerHTML = `<option value="all">전체 (${records.length})</option>` +
    months.map((m) => `<option value="${m}">${m.replace("-", "년 ")}월 (${records.filter((r) => inMonth(r, m)).length})</option>`).join("");
  filter.value = months.includes(cur) ? cur : "all";

  const list = filter.value === "all" ? records : records.filter((r) => inMonth(r, filter.value));
  for (const [key, suffix] of [["ko", "Ko"], ["en", "En"]]) {
    const items = list.filter((r) => shelfOf(r) === key);
    $("shelf" + suffix).innerHTML = items.map(cardHtml).join("");
    $("count" + suffix).textContent = `${items.length}권`;
    $("empty" + suffix).hidden = items.length > 0;
  }

  const thisMonth = records.filter((r) => inMonth(r, localDay().slice(0, 7))).length;
  $("stats").innerHTML = `이번 달 <b>${thisMonth}</b>권<br>모두 <b>${records.length}</b>권`;
  renderCalendar();
  if ($("dayDialog").open && openDayKey) fillDay(openDayKey);
}

$("monthFilter").addEventListener("change", render);

// ---------- 책장에서 책 누르면: 기록 보기 ----------
let viewing = null;
function openView(id) {
  const r = records.find((x) => x.id === id); if (!r) return;
  viewing = r;
  fillView(r);
  $("viewDialog").showModal();
}
function fillView(r) {
  if (r.cover) $("vCover").src = r.cover; else $("vCover").removeAttribute("src");
  $("vTitle").textContent = r.title;
  $("vAuthor").textContent = r.authors || "";
  $("vMeta").textContent = [shelfOf(r) === "ko" ? "🇰🇷 한글책" : "🔤 영어책", r.totalPages && `전체 ${r.totalPages}쪽`, r.isbn && `ISBN ${r.isbn}`].filter(Boolean).join(" · ");
  $("vProgress").innerHTML = progressText(r)
    ? `<b>${esc(progressText(r))}</b>${r.totalPages ? `<div class="bar"><i style="width:${pct(r)}%"></i></div>` : ""}` : "";
  $("vSessions").innerHTML = [...r.sessions].sort((a, b) => a.day.localeCompare(b.day))
    .map((s) => `<li><span>${prettyDay(s.day)}</span><b>${sessionText(s)}</b></li>`).join("");
  $("vMore").hidden = !!(r.totalPages && readTo(r) >= r.totalPages);
  $("vScore").textContent = r.score ? `${"★".repeat(r.score)}${"☆".repeat(5 - r.score)}  ${r.score}점` : (r.sticker || "주지 않았어요");
  $("vNote").textContent = r.note || "적지 않았어요";
  $("vTotalRow").hidden = !!r.totalPages;
  $("vTotal").value = "";
}
$("vTotalSave").addEventListener("click", () => {
  const t = parseInt($("vTotal").value, 10);
  if (!viewing || !t) return;
  viewing.totalPages = t;
  saveRecords(records); render(); fillView(viewing);
  toast(`전체 ${t}쪽으로 저장했어요`);
});
for (const id of ["shelfKo", "shelfEn"]) {
  $(id).addEventListener("click", (e) => { const li = e.target.closest("li[data-id]"); if (li) openView(li.dataset.id); });
  $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { const li = e.target.closest("li[data-id]"); if (li) openView(li.dataset.id); } });
}
$("viewDialog").addEventListener("close", () => {
  const v = $("viewDialog").returnValue;
  const r = viewing; viewing = null;
  if (!r) return;
  if (v === "more") openMore(r);
  else if (v === "delete" && confirm(`'${r.title}' 기록을 모두 지울까요?`)) {
    records = records.filter((x) => x.id !== r.id);
    saveRecords(records); render();
    toast("기록을 지웠어요");
  }
});

// ---------- 이어서 기록하기 (쪽수 + 날짜만) ----------
let moreTarget = null;
function openMore(r) {
  moreTarget = r;
  if (r.cover) $("mCover").src = r.cover; else $("mCover").removeAttribute("src");
  $("mTitle").textContent = r.title;
  const to = readTo(r);
  $("mSoFar").textContent = to ? `지난번까지 ${to}쪽 읽었어요${r.totalPages ? ` · 전체 ${r.totalPages}쪽` : ""}` : "이어서 읽은 쪽수를 적어 주세요";
  $("mPageFrom").value = to ? to + 1 : 1;
  $("mPageTo").value = r.totalPages && r.totalPages > to ? r.totalPages : "";
  resetMDate(returnDay);
  $("moreDialog").showModal();
}
$("moreDialog").addEventListener("close", () => {
  const r = moreTarget; moreTarget = null;
  if ($("moreDialog").returnValue !== "save" || !r) return;
  const { from, to } = parsePages("mPageFrom", "mPageTo");
  r.sessions.push({ from, to, day: pickDay("mDate") });
  records = [r, ...records.filter((x) => x.id !== r.id)]; // 최근 읽은 책이 앞으로
  saveRecords(records); render();
  toast(r.totalPages && readTo(r) >= r.totalPages ? `🎉 '${r.title}' 다 읽었어요!` : `📖 ${sessionText({ from, to })} 추가했어요`);
});

// ---------- 새 책 기록 ----------
let pending = null;
let chosenScore = 0;
let chosenShelf = "ko";
const paintShelf = () => [...$("shelfPick").children].forEach((x) => x.setAttribute("aria-checked", String(x.dataset.shelf === chosenShelf)));
$("shelfPick").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  chosenShelf = b.dataset.shelf; paintShelf();
});
$("scores").innerHTML = SCORES.map((n) => `<button type="button" role="radio" aria-checked="false" data-n="${n}"><b>${n}</b><small>점</small></button>`).join("");
const paintScores = () => [...$("scores").children].forEach((x) => x.setAttribute("aria-checked", String(Number(x.dataset.n) === chosenScore)));
$("scores").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const n = Number(b.dataset.n);
  chosenScore = chosenScore === n ? 0 : n;
  paintScores();
});

async function openBook(isbn, scanInfo, preset) {
  // 이미 책장에 있는 책이면 '이어서 기록하기'로
  const existing = records.find((r) => r.isbn === isbn);
  if (existing) {
    toast("이미 책장에 있는 책이에요. 이어서 기록할게요!");
    openMore(existing);
    return;
  }
  $("bTiming").textContent = "책 정보를 찾는 중…";
  $("bTitle").value = ""; $("bAuthor").value = ""; $("bNote").value = "";
  $("bPageFrom").value = 1; $("bPageTo").value = ""; $("bTotal").value = "";
  $("bTotalHint").textContent = "(책 마지막 쪽 번호)";
  resetBDate(returnDay);
  chosenShelf = isbn.startsWith("97911") || isbn.startsWith("97889") ? "ko" : "en";
  paintShelf();
  $("bMeta").textContent = `ISBN ${isbn}`;
  $("bCover").removeAttribute("src");
  chosenScore = 0;
  paintScores();
  $("bookDialog").showModal();

  const { book, ms, cached } = preset || await lookupBook(isbn);
  pending = { isbn, book };
  const parts = [];
  if (scanInfo) parts.push(`인식 ${(scanInfo.ms / 1000).toFixed(2)}초 (${scanInfo.engine})`);
  parts.push(cached ? "조회 캐시 즉시" : `조회 ${(ms / 1000).toFixed(2)}초${book ? ` · ${book.source}` : ""}`);
  $("bTiming").textContent = parts.join(" · ");

  if (book) {
    $("bTitle").value = book.title;
    $("bAuthor").value = book.authors.join(", ");
    $("bMeta").textContent = [book.publisher, book.pages && `${book.pages}쪽`, `ISBN ${isbn}`].filter(Boolean).join(" · ");
    if (book.cover) $("bCover").src = book.cover;
    // 쪽수 기본값: 1 ~ 책의 마지막 쪽
    if (book.pages) {
      $("bTotal").value = book.pages; $("bPageTo").value = book.pages;
      $("bTotalHint").textContent = "(자동으로 채웠어요)";
    }
    // 제목에 한글이 있으면 한글책, 없으면 영어책 (기록 전에 직접 바꿀 수 있음)
    chosenShelf = hasHangul(book.title) ? "ko" : "en";
    paintShelf();
  } else {
    $("bTiming").textContent += " · 책 정보를 찾지 못했어요. 제목을 직접 적어 주세요.";
    $("bTitle").focus();
  }
}

// 전체 쪽수를 적으면 '~ 마지막 쪽' 칸도 같이 채움
$("bTotal").addEventListener("input", () => {
  const t = parseInt($("bTotal").value, 10);
  if (t && (!$("bPageTo").value || $("bPageTo").dataset.auto === "1")) { $("bPageTo").value = t; $("bPageTo").dataset.auto = "1"; }
});
$("bPageTo").addEventListener("input", () => { $("bPageTo").dataset.auto = ""; });

$("bookDialog").addEventListener("close", () => {
  if ($("bookDialog").returnValue !== "save" || !pending) return;
  const title = $("bTitle").value.trim();
  if (!title) return;
  const { from, to } = parsePages("bPageFrom", "bPageTo");
  const day = pickDay("bDate");
  records.unshift({
    id: crypto.randomUUID?.() || String(Date.now()),
    isbn: pending.isbn,
    title,
    authors: $("bAuthor").value.trim(),
    cover: $("bCover").getAttribute("src") || "",
    note: $("bNote").value.trim(),
    score: chosenScore || null,
    shelf: chosenShelf,
    totalPages: parseInt($("bTotal").value, 10) || null,
    sessions: [{ from, to, day }],
    date: new Date().toISOString(),
  });
  saveRecords(records);
  $("monthFilter").value = "all";
  render();
  const shelfName = chosenShelf === "ko" ? "한글책" : "영어책";
  toast(chosenScore ? `★ ${chosenScore}점으로 ${shelfName} 책장에 꽂았어요!` : `${shelfName} 책장에 꽂았어요!`);
  pending = null;
});

// ---------- 책 검색 결과 ----------
let infoBook = null;
async function openInfo(isbn, scanInfo) {
  $("iTitle").textContent = "책 정보를 찾는 중…";
  $("iAuthor").textContent = ""; $("iMeta").textContent = `ISBN ${isbn}`;
  $("iDesc").textContent = ""; $("iTiming").textContent = "";
  $("iLink").hidden = true; $("iRecord").hidden = true;
  $("iCover").removeAttribute("src");
  $("infoDialog").showModal();

  const res = await lookupBook(isbn, { needDescription: true });
  const { book, ms, cached } = res;
  infoBook = { isbn, res };
  const parts = [];
  if (scanInfo) parts.push(`인식 ${(scanInfo.ms / 1000).toFixed(2)}초`);
  parts.push(cached ? "조회 캐시 즉시" : `조회 ${(ms / 1000).toFixed(2)}초`);
  $("iTiming").textContent = parts.join(" · ");

  if (!book) {
    $("iTitle").textContent = "책 정보를 찾지 못했어요";
    $("iDesc").textContent = "연결된 도서 정보(카카오 책, Google Books, Open Library)에 이 ISBN이 없어요. 바코드 숫자를 다시 확인해 주세요.";
    return;
  }
  $("iTitle").textContent = book.title;
  $("iAuthor").textContent = book.authors.join(", ");
  $("iMeta").textContent = [book.publisher, book.pages && `${book.pages}쪽`, `ISBN ${isbn}`].filter(Boolean).join(" · ");
  if (book.cover) $("iCover").src = book.cover;
  $("iDesc").textContent = book.description || "이 책은 연결된 사이트에 소개글이 없어요.";
  const src = book.descSource || book.source;
  if (book.link) {
    $("iLink").href = book.link;
    $("iLink").textContent = `${book.source}에서 자세히 보기 ↗`;
    $("iLink").hidden = false;
  }
  $("iTiming").textContent += ` · 소개: ${book.description ? src : "없음"}`;
  const mine = records.find((r) => r.isbn === isbn);
  $("iRecord").textContent = mine ? "이어서 기록하기" : "이 책 기록하기";
  $("iRecord").hidden = false;
  if (mine) $("iTiming").textContent += " · 이미 내 책장에 있어요";
}
$("infoDialog").addEventListener("close", () => {
  if ($("infoDialog").returnValue === "record" && infoBook) {
    const { isbn, res } = infoBook;
    openBook(isbn, null, { ...res, cached: true });
  }
  infoBook = null;
});

// ---------- 포트폴리오 (캘린더 + 날짜별 기록) ----------
const JOURNAL_KEY = "kbc:journal:v1";
const CATS = [
  { key: "ko", icon: "📕", name: "한글책", book: true },
  { key: "en", icon: "📘", name: "영어책", book: true },
  { key: "listen", icon: "🎧", name: "흘려듣기", what: "무엇을 들었나요?", whatPh: "예: Peppa Pig 3화", amount: "몇 분 들었나요?", unit: "분" },
  { key: "focus", icon: "👂", name: "집중듣기", what: "무엇을 들었나요?", whatPh: "예: Magic Tree House 1권", amount: "몇 분 들었나요?", unit: "분" },
  { key: "math", icon: "➗", name: "수학", what: "무엇을 했나요?", whatPh: "예: 연산 문제집 12~15쪽", amount: "몇 분 했나요?", unit: "분" },
  { key: "etc", icon: "⭐", name: "기타", what: "무엇을 했나요?", whatPh: "예: 피아노 연습", amount: "몇 분 했나요?", unit: "분" },
  { key: "memo", icon: "📝", name: "메모", text: "메모", textPh: "오늘 있었던 일, 칭찬할 점 등" },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.key, c]));
const loadJournal = () => { try { return JSON.parse(localStorage.getItem(JOURNAL_KEY)) || []; } catch { return []; } };
const saveJournal = () => localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
let journal = loadJournal();

// 그날 읽은 책 (책장 기록에서 자동으로 가져옴)
const booksOn = (day, shelf) => records.flatMap((r) =>
  r.sessions.filter((s) => s.day === day && shelfOf(r) === shelf).map((s) => ({ r, s })));
const catsOn = (day) => CATS.filter((c) => (c.book ? booksOn(day, c.key).length : journal.some((j) => j.day === day && j.cat === c.key)));

// 캘린더
let calYM = localDay().slice(0, 7);
function renderCalendar() {
  const [y, m] = calYM.split("-").map(Number);
  $("calTitle").textContent = `${y}.${String(m).padStart(2, "0")}.`;
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - first.getDay());
  const today = localDay();
  let html = "";
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const day = localDay(d);
    if (i >= 35 && d.getMonth() !== m - 1) break; // 필요 없는 마지막 줄 생략
    const cats = catsOn(day);
    const cls = [d.getMonth() !== m - 1 && "out", day === today && "today", cats.length && "has"].filter(Boolean).join(" ");
    const dots = cats.slice(0, 4).map((c) => c.icon).join("") + (cats.length > 4 ? "+" : "");
    html += `<button type="button" class="${cls}" data-day="${day}" ${day > today ? "disabled" : ""} aria-label="${prettyDay(day)} 기록">
      <span class="num">${d.getDate()}</span><span class="dots">${dots}</span></button>`;
  }
  $("calGrid").innerHTML = html;
  $("calLegend").textContent = CATS.map((c) => `${c.icon}${c.name}`).join("  ");
}
$("calPrev").addEventListener("click", () => { const [y, m] = calYM.split("-").map(Number); calYM = localDay(new Date(y, m - 2, 1)).slice(0, 7); renderCalendar(); });
$("calNext").addEventListener("click", () => { const [y, m] = calYM.split("-").map(Number); calYM = localDay(new Date(y, m, 1)).slice(0, 7); renderCalendar(); });
$("calGrid").addEventListener("click", (e) => { const b = e.target.closest("button[data-day]"); if (b && !b.disabled) openDay(b.dataset.day); });

// 날짜 화면
let openDayKey = null;  // 지금 열려 있는 날짜 화면
let returnDay = null;   // 다른 창을 다 쓰고 나면 돌아올 날짜 화면 (기록 날짜 기본값으로도 사용)
let dayPanel = null;    // 한글책/영어책 버튼을 눌렀을 때 펼치는 패널
function openDay(day) {
  openDayKey = day; returnDay = day; dayPanel = null;
  fillDay(day);
  if (!$("dayDialog").open) $("dayDialog").showModal();
}
function fillDay(day) {
  const [, m, d] = day.split("-").map(Number);
  $("dayTitle").innerHTML = `${m}월 ${d}일에<br>무엇을 기록할까요?`;
  $("dayCats").innerHTML = CATS.map((c) => {
    const n = c.book ? booksOn(day, c.key).length : journal.filter((j) => j.day === day && j.cat === c.key).length;
    return `<button type="button" data-cat="${c.key}"><span class="ic">${c.icon}</span>${c.name}${n ? `<span class="cnt">${n}</span>` : ""}</button>`;
  }).join("");

  let html = "";
  if (dayPanel) {
    const c = CAT[dayPanel];
    const ongoing = records.filter((r) => shelfOf(r) === dayPanel && !(r.totalPages && readTo(r) >= r.totalPages));
    html += `<div class="day-actions">
        <button type="button" class="btn primary" data-act="scan">📷 바코드로 새 책</button>
        <button type="button" class="btn ghost" data-act="isbn" style="background:#2A2838;color:#F2EEF8">ISBN 입력</button>
      </div>`;
    html += ongoing.length ? `<small style="color:#B9B5CC">읽고 있는 ${c.name} (눌러서 이 날 읽은 쪽수 기록)</small>` +
      ongoing.map((r) => `<div class="day-item link" data-more="${r.id}">
        ${r.cover ? `<img src="${esc(r.cover)}" alt="">` : `<span>${c.icon}</span>`}
        <div class="grow"><b>${esc(r.title)}</b><small>${progressText(r) || "아직 쪽수 기록 없음"}</small></div><span>➕</span></div>`).join("")
      : `<small style="color:#B9B5CC">읽고 있는 ${c.name}이 아직 없어요. 바코드로 새 책을 기록해 보세요.</small>`;
  } else {
    for (const c of CATS) {
      if (c.book) {
        for (const { r, s } of booksOn(day, c.key)) {
          html += `<div class="day-item link" data-view="${r.id}">
            ${r.cover ? `<img src="${esc(r.cover)}" alt="">` : `<span>${c.icon}</span>`}
            <div class="grow"><b>${c.icon} ${esc(r.title)}</b><small>${sessionText(s)}</small></div></div>`;
        }
      } else {
        for (const j of journal.filter((x) => x.day === day && x.cat === c.key)) {
          const sub = [j.minutes ? `${j.minutes}${c.unit}` : "", j.text || ""].filter(Boolean).join(" · ");
          html += `<div class="day-item"><span>${c.icon}</span>
            <div class="grow"><b>${esc(j.what || c.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>
            <button type="button" class="x" data-del="${j.id}" aria-label="지우기">✕</button></div>`;
        }
      }
    }
    if (!html) html = `<small style="color:#8E8AA3;text-align:center">아직 이 날의 기록이 없어요. 위 카테고리를 눌러 기록해 보세요.</small>`;
  }
  $("dayList").innerHTML = html;
}
$("dayCats").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-cat]"); if (!b) return;
  const c = CAT[b.dataset.cat];
  if (c.book) { dayPanel = dayPanel === c.key ? null : c.key; fillDay(openDayKey); return; }
  openEntry(c.key);
});
$("dayList").addEventListener("click", (e) => {
  const t = e.target.closest("[data-act],[data-more],[data-view],[data-del]"); if (!t) return;
  const day = openDayKey;
  if (t.dataset.del) {
    if (!confirm("이 기록을 지울까요?")) return;
    journal = journal.filter((j) => j.id !== t.dataset.del); saveJournal(); render(); return;
  }
  // 다른 창을 열기 전에 날짜 화면을 잠시 닫고, 끝나면 다시 돌아옴
  $("dayDialog").close("away"); returnDay = day;
  if (t.dataset.act === "scan") { mode = "record"; openScanner(); }
  else if (t.dataset.act === "isbn") { mode = "record"; openManual(); }
  else if (t.dataset.more) openMore(records.find((r) => r.id === t.dataset.more));
  else if (t.dataset.view) openView(t.dataset.view);
});
$("dayDialog").addEventListener("close", () => {
  if ($("dayDialog").returnValue !== "away") { returnDay = null; }
  openDayKey = null;
});
// 다른 창이 모두 닫히면 날짜 화면으로 돌아오기
function maybeReturn() {
  setTimeout(() => {
    if (returnDay && !document.querySelector("dialog[open]") && $("scanner").hidden) openDay(returnDay);
  }, 60);
}
["bookDialog", "moreDialog", "viewDialog", "manualDialog", "entryDialog", "infoDialog"].forEach((id) => $(id).addEventListener("close", maybeReturn));

// 카테고리 기록 입력
let entryCat = null;
function openEntry(cat) {
  const c = CAT[cat]; entryCat = cat;
  $("eTitle").textContent = `${c.icon} ${c.name} · ${prettyDay(openDayKey)}`;
  $("eWhatWrap").hidden = !c.what; $("eWhatLabel").textContent = c.what || ""; $("eWhat").placeholder = c.whatPh || ""; $("eWhat").value = "";
  $("eAmountWrap").hidden = !c.amount; $("eAmountLabel").textContent = c.amount || ""; $("eUnit").textContent = c.unit || ""; $("eAmount").value = "";
  $("eTextWrap").hidden = false; $("eTextLabel").textContent = c.text || "한 줄 메모 (선택)"; $("eText").placeholder = c.textPh || ""; $("eText").value = "";
  $("eText").rows = c.text ? 5 : 2;
  $("dayDialog").close("away"); returnDay = openDayKey || returnDay;
  $("entryDialog").showModal();
}
$("entryDialog").addEventListener("close", () => {
  if ($("entryDialog").returnValue !== "save" || !entryCat) return;
  const what = $("eWhat").value.trim(), text = $("eText").value.trim(), minutes = parseInt($("eAmount").value, 10) || null;
  if (!what && !text && !minutes) { toast("내용을 적어 주세요"); return; }
  journal.push({ id: crypto.randomUUID?.() || String(Date.now()), day: returnDay || localDay(), cat: entryCat, what, minutes, text });
  saveJournal(); render();
  toast(`${CAT[entryCat].icon} ${CAT[entryCat].name} 기록했어요`);
  entryCat = null;
});

// 모드에 따라 결과 화면 분기
const handleIsbn = (isbn, scanInfo) => (mode === "search" ? openInfo(isbn, scanInfo) : openBook(isbn, scanInfo));

// ---------- 스캐너 ----------
const scanner = new Scanner({
  video: $("video"),
  roiEl: $("roi"),
  onStatus: (msg) => ($("scanHint").textContent = msg),
  onDetect: (info) => {
    beep();
    $("roi").classList.add("hit");
    setTimeout(() => { closeScanner(); handleIsbn(info.isbn, info); }, 120);
  },
});

async function openScanner() {
  $("scanMode").textContent = MODE_LABEL[mode];
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

document.querySelectorAll("[data-scan]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.scan; returnDay = null; openScanner(); }));
$("closeScan").addEventListener("click", () => { closeScanner(); maybeReturn(); });
$("zoom").addEventListener("input", (e) => scanner.setZoom(Number(e.target.value)));
$("torchBtn").addEventListener("click", async () => {
  const on = !$("torchBtn").classList.contains("on");
  if (await scanner.setTorch(on)) $("torchBtn").classList.toggle("on", on);
});
document.addEventListener("visibilitychange", () => { if (document.hidden && !$("scanner").hidden) closeScanner(); });

// ---------- 직접 입력 ----------
function openManual() {
  $("manualTitle").textContent = `${MODE_LABEL[mode]} · ISBN 입력`;
  $("manualIsbn").value = ""; $("manualErr").textContent = "";
  $("manualDialog").showModal();
}
document.querySelectorAll("[data-manual]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.manual; returnDay = null; openManual(); }));
$("manualDialog").addEventListener("close", () => {
  if ($("manualDialog").returnValue !== "ok") return;
  const isbn = toIsbn13($("manualIsbn").value);
  if (!isbn) { toast("올바른 ISBN이 아니에요. 숫자를 다시 확인해 주세요."); return; }
  handleIsbn(isbn, null);
});

// 키보드 Enter(이동)를 누르면 '취소'가 아니라 '찾기/기록하기'가 눌리도록:
// 취소·닫기 버튼은 제출 버튼에서 빼고 직접 창을 닫게 함
document.querySelectorAll('dialog button[value="cancel"], dialog button[value="close"]').forEach((b) => {
  b.type = "button";
  b.addEventListener("click", () => b.closest("dialog").close(b.value));
});

// ---------- 시작 ----------
render();
warmUpDetector(); // 엔진 미리 준비
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
