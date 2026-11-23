// 도서 정보 조회
// 속도 개선 핵심:
//  1) 로컬 캐시 우선 (같은 책 재조회 0ms)
//  2) 여러 DB(카카오 · Google Books · Open Library)에 동시에 요청하고, 먼저 '찾음'으로 응답한 곳을 바로 사용 (Promise.any)
//  3) 요청마다 타임아웃 → 느린 서버 하나 때문에 전체가 멈추지 않음
import { isbn13to10 } from "./isbn.js";

const CACHE_KEY = "kbc:bookcache:v2";
const TIMEOUT_MS = 5000;

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}
function writeCache(isbn, book) {
  try {
    const c = readCache();
    c[isbn] = book;
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch { /* 저장 공간 부족 등은 무시 */ }
}

async function fetchJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const stripTags = (h) => h.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const https = (u) => (u ? u.replace(/^http:\/\//, "https://") : "");

async function fromOpenLibrary(isbn, signal) {
  const key = `ISBN:${isbn}`;
  const data = await fetchJson(
    `https://openlibrary.org/api/books?bibkeys=${key}&format=json&jscmd=data`, signal);
  const b = data[key];
  if (!b || !b.title) throw new Error("not found");
  return {
    title: b.subtitle ? `${b.title}: ${b.subtitle}` : b.title,
    authors: (b.authors || []).map((a) => a.name),
    publisher: b.publishers?.[0]?.name || "",
    pages: b.number_of_pages || null,
    cover: https(b.cover?.medium || b.cover?.large || ""),
    description: "",
    link: b.url || "",
    source: "Open Library",
  };
}

async function fromGoogleBooks(isbn, signal) {
  const data = await fetchJson(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`, signal);
  const v = data.items?.[0]?.volumeInfo;
  if (!v || !v.title) throw new Error("not found");
  return {
    title: v.subtitle ? `${v.title}: ${v.subtitle}` : v.title,
    authors: v.authors || [],
    publisher: v.publisher || "",
    pages: v.pageCount || null,
    cover: https(v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || ""),
    description: stripTags(v.description || ""),
    link: https(v.infoLink || ""),
    source: "Google Books",
  };
}

// 책 소개 보강용: Open Library 판(edition) → 작품(work) 순서로 소개글 찾기
const cleanOL = (t) => t.split(/\n-{3,}/)[0]
  .replace(/\(\[source\]\[\d+\]\)/gi, "").replace(/\[([^\]]+)\]\[\d+\]/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
async function olDescription(isbn, signal) {
  const ed = await fetchJson(`https://openlibrary.org/isbn/${isbn}.json`, signal);
  let d = ed.description;
  if (!d && ed.works?.[0]?.key) d = (await fetchJson(`https://openlibrary.org${ed.works[0].key}.json`, signal)).description;
  d = typeof d === "string" ? d : d?.value;
  if (!d) throw new Error("no description");
  return { description: cleanOL(d), source: "Open Library", link: `https://openlibrary.org/isbn/${isbn}` };
}
const DESC_PRIORITY = ["카카오 책", "Google Books", "Open Library"];

// 한글책: 카카오 책 검색 (우리 서버 /api/book 경유, 키 숨김)
async function fromKakao(isbn, signal) {
  const res = await fetch(`/api/book?isbn=${isbn}`, { signal });
  if (!res.ok) throw new Error(`kakao ${res.status}`);
  const b = await res.json();
  if (!b.title) throw new Error("not found");
  return b;
}

// 979-11, 978-89로 시작하면 한국에서 발행된 책
const isKorean = (isbn) => isbn.startsWith("97911") || isbn.startsWith("97889");

/**
 * @param {string} isbn
 * @param {{needDescription?: boolean}} opts  책 검색 화면이면 true → 설명이 있는 결과를 조금 더 기다림
 * @returns {Promise<{book: object|null, ms: number, cached: boolean}>}
 */
export async function lookupBook(isbn, { needDescription = false } = {}) {
  const t0 = performance.now();
  const cached = readCache()[isbn];
  if (cached && (!needDescription || cached.description)) {
    return { book: cached, ms: performance.now() - t0, cached: true };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let book = null;
  try {
    // 세 곳에 동시에 묻고 먼저 찾은 결과 사용.
    // 한국 책은 카카오 정보가 가장 정확하므로 카카오를 먼저 기다려 보고, 없으면 나머지 결과 사용
    const kakao = fromKakao(isbn, ctrl.signal);
    const others = [fromGoogleBooks(isbn, ctrl.signal), fromOpenLibrary(isbn, ctrl.signal)];
    others.forEach((p) => p.catch(() => {})); // 취소된 요청 경고 방지
    const all = [kakao, ...others];
    const extra = needDescription ? [olDescription(isbn, ctrl.signal)] : [];
    const done = [];
    [...all, ...extra].forEach((p) => p.then((b) => done.push(b), () => {}));
    book = isKorean(isbn)
      ? await kakao.catch(() => Promise.any(others))
      : await Promise.any(all);
    // 카카오는 쪽수를 안 주므로, 이미 도착한 다른 결과에 쪽수가 있으면 빌려 옴
    if (book && !book.pages) {
      await sleep(needDescription ? 0 : 300);
      const withPages = done.find((b) => b.pages);
      if (withPages) book = { ...book, pages: withPages.pages };
    }
    // 책 검색: 먼저 온 결과에 설명이 없으면 다른 곳의 설명을 최대 2.5초 더 기다려 채움
    if (needDescription && book && !book.description) {
      await Promise.race([Promise.allSettled([...all, ...extra]), sleep(2500)]);
      const withDesc = done.filter((b) => b.description)
        .sort((a, b) => DESC_PRIORITY.indexOf(a.source) - DESC_PRIORITY.indexOf(b.source))[0];
      if (withDesc) book = { ...book, description: withDesc.description, descSource: withDesc.source, link: book.link || withDesc.link };
    }
  } catch { /* 모든 소스에서 못 찾음 */ }
  finally {
    clearTimeout(timer);
    ctrl.abort(); // 이긴 요청 외 나머지는 취소
  }

  if (book) {
    if (!book.cover) book.cover = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
    book.isbn10 = isbn13to10(isbn);
    writeCache(isbn, book);
  }
  return { book, ms: performance.now() - t0, cached: false };
}
