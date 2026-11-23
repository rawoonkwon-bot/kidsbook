import { Scanner, warmUpDetector } from "./scanner.js";
import { lookupBook } from "./lookup.js";
import { toIsbn13 } from "./isbn.js";

const $ = (id) => document.getElementById(id);
const REC_KEY = "kbc:records:v1";
const SCORES = [5, 4, 3, 2, 1];
const MODE_LABEL = { search: "🔍 책 검색", record: "📚 책 기록" };
let mode = "record"; // 지금 스캔/입력이 어느 박스에서 시작됐는지

// ---------- 저장소 ----------
const loadRecords = () => { try { return JSON.parse(localStorage.getItem(REC_KEY)) || []; } catch { return []; } };
const saveRecords = (r) => localStorage.setItem(REC_KEY, JSON.stringify(r));
let records = loadRecords();

// ---------- UI 유틸 ----------
let toastTimer;
function toast(msg, ms = 2200) {
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
const ym = (iso) => iso.slice(0, 7);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- 책장 ----------
// 한글책/영어책 구분: 기록할 때 고른 책장, 없으면(예전 기록) 제목에 한글이 있는지로 판단
const hasHangul = (t) => /[가-힣]/.test(t || "");
const shelfOf = (r) => r.shelf || (hasHangul(r.title) ? "ko" : "en");
const pagesText = (r) => {
  if (r.pageFrom && r.pageTo) return `${r.pageFrom}~${r.pageTo}쪽 (${r.pageTo - r.pageFrom + 1}쪽)`;
  if (r.pageTo) return `~${r.pageTo}쪽`;
  if (r.pageFrom) return `${r.pageFrom}쪽부터`;
  return "";
};
const cardHtml = (r) => `
    <li data-id="${r.id}" tabindex="0" role="button" aria-label="${esc(r.title)} 기록 보기">
      ${r.cover ? `<img class="cover" src="${esc(r.cover)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cover',textContent:'📘'}))">` : `<div class="cover">📘</div>`}
      ${r.score ? `<span class="s score-badge">★ ${r.score}</span>` : r.sticker ? `<span class="s">${r.sticker}</span>` : ""}
      <div class="t">${esc(r.title)}</div>
      <div class="a">${esc(r.authors)}</div>
      ${pagesText(r) ? `<div class="p">📖 ${pagesText(r)}</div>` : ""}
      <div class="d">${r.date.slice(0, 10).replaceAll("-", ".")}</div>
    </li>`;

function render() {
  const filter = $("monthFilter");
  const months = [...new Set(records.map((r) => ym(r.date)))].sort().reverse();
  const cur = filter.value || "all";
  filter.innerHTML = `<option value="all">전체 (${records.length})</option>` +
    months.map((m) => `<option value="${m}">${m.replace("-", "년 ")}월 (${records.filter((r) => ym(r.date) === m).length})</option>`).join("");
  filter.value = months.includes(cur) ? cur : "all";

  const list = filter.value === "all" ? records : records.filter((r) => ym(r.date) === filter.value);
  for (const [key, suffix] of [["ko", "Ko"], ["en", "En"]]) {
    const items = list.filter((r) => shelfOf(r) === key);
    $("shelf" + suffix).innerHTML = items.map(cardHtml).join("");
    $("count" + suffix).textContent = `${items.length}권`;
    $("empty" + suffix).hidden = items.length > 0;
  }

  const thisMonth = records.filter((r) => ym(r.date) === ym(new Date().toISOString())).length;
  $("stats").innerHTML = `이번 달 <b>${thisMonth}</b>권<br>모두 <b>${records.length}</b>권`;
}

$("monthFilter").addEventListener("change", render);

// 책장에서 책 누르면 기록 보기
let viewing = null;
function openView(id) {
  const r = records.find((x) => x.id === id); if (!r) return;
  viewing = r;
  if (r.cover) $("vCover").src = r.cover; else $("vCover").removeAttribute("src");
  $("vTitle").textContent = r.title;
  $("vAuthor").textContent = r.authors || "";
  $("vMeta").textContent = [shelfOf(r) === "ko" ? "🇰🇷 한글책" : "🔤 영어책", r.isbn && `ISBN ${r.isbn}`].filter(Boolean).join(" · ");
  $("vPages").textContent = pagesText(r) || "적지 않았어요";
  $("vScore").textContent = r.score ? `${"★".repeat(r.score)}${"☆".repeat(5 - r.score)}  ${r.score}점` : (r.sticker || "주지 않았어요");
  $("vDate").textContent = new Date(r.date).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  $("vNote").textContent = r.note || "적지 않았어요";
  $("viewDialog").showModal();
}
for (const id of ["shelfKo", "shelfEn"]) {
  $(id).addEventListener("click", (e) => { const li = e.target.closest("li[data-id]"); if (li) openView(li.dataset.id); });
  $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { const li = e.target.closest("li[data-id]"); if (li) openView(li.dataset.id); } });
}
$("viewDialog").addEventListener("close", () => {
  if ($("viewDialog").returnValue === "delete" && viewing && confirm(`'${viewing.title}' 기록을 지울까요?`)) {
    records = records.filter((r) => r.id !== viewing.id);
    saveRecords(records); render();
    toast("기록을 지웠어요");
  }
  viewing = null;
});

// ---------- 기록 다이얼로그 ----------
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
  $("bTiming").textContent = "책 정보를 찾는 중…";
  $("bTitle").value = ""; $("bAuthor").value = ""; $("bNote").value = "";
  $("bPageFrom").value = ""; $("bPageTo").value = "";
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
    // 제목에 한글이 있으면 한글책, 없으면 영어책 (기록 전에 직접 바꿀 수 있음)
    chosenShelf = hasHangul(book.title) ? "ko" : "en";
    paintShelf();
  } else {
    $("bTiming").textContent += " · 책 정보를 찾지 못했어요. 제목을 직접 적어 주세요.";
    $("bTitle").focus();
  }
  if (records.some((r) => r.isbn === isbn)) toast("이미 책장에 있는 책이에요. 또 읽었나요? 👏");
}

$("bookDialog").addEventListener("close", () => {
  if ($("bookDialog").returnValue !== "save" || !pending) return;
  const title = $("bTitle").value.trim();
  if (!title) return;
  let from = parseInt($("bPageFrom").value, 10) || null;
  let to = parseInt($("bPageTo").value, 10) || null;
  if (from && to && from > to) [from, to] = [to, from];
  records.unshift({
    id: crypto.randomUUID?.() || String(Date.now()),
    isbn: pending.isbn,
    title,
    authors: $("bAuthor").value.trim(),
    cover: $("bCover").getAttribute("src") || "",
    note: $("bNote").value.trim(),
    score: chosenScore || null,
    pageFrom: from,
    pageTo: to,
    shelf: chosenShelf,
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
  $("iRecord").hidden = false;
  if (records.some((r) => r.isbn === isbn)) $("iTiming").textContent += " · 이미 내 책장에 있어요";
}
$("infoDialog").addEventListener("close", () => {
  if ($("infoDialog").returnValue === "record" && infoBook) {
    const { isbn, res } = infoBook;
    openBook(isbn, null, { ...res, cached: true });
  }
  infoBook = null;
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
    closeScanner();
    toast(e.name === "NotAllowedError" ? "카메라 권한을 허용해 주세요." : "카메라를 열 수 없어요. ISBN을 직접 입력해 주세요.", 3200);
  }
}
function closeScanner() {
  scanner.stop();
  $("scanner").hidden = true;
  $("torchBtn").classList.remove("on");
}

document.querySelectorAll("[data-scan]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.scan; openScanner(); }));
$("closeScan").addEventListener("click", closeScanner);
$("zoom").addEventListener("input", (e) => scanner.setZoom(Number(e.target.value)));
$("torchBtn").addEventListener("click", async () => {
  const on = !$("torchBtn").classList.contains("on");
  if (await scanner.setTorch(on)) $("torchBtn").classList.toggle("on", on);
});
document.addEventListener("visibilitychange", () => { if (document.hidden && !$("scanner").hidden) closeScanner(); });

// ---------- 직접 입력 ----------
document.querySelectorAll("[data-manual]").forEach((b) => b.addEventListener("click", () => {
  mode = b.dataset.manual;
  $("manualTitle").textContent = `${MODE_LABEL[mode]} · ISBN 입력`;
  $("manualIsbn").value = ""; $("manualErr").textContent = "";
  $("manualDialog").showModal();
}));
$("manualDialog").addEventListener("close", () => {
  if ($("manualDialog").returnValue !== "ok") return;
  const isbn = toIsbn13($("manualIsbn").value);
  if (!isbn) { toast("올바른 ISBN이 아니에요. 숫자를 다시 확인해 주세요."); return; }
  handleIsbn(isbn, null);
});

// ---------- 시작 ----------
render();
warmUpDetector(); // 엔진 미리 준비
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
