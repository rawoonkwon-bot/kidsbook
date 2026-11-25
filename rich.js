// 사진이 글 사이에 들어가는 글쓰기 (블로그 · 메모 같이 씀)
// 저장 모양: 글(body) 안에서 사진 자리는 한 줄짜리 "￼" 표시, 사진 경로는 photos 배열에 같은 순서로
export const MARK = "￼";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 글씨 꾸미기(블로그): 고른 글자를 "\uE000 s3c2 \uE001 글자 \uE002" 로 저장. 크기 s1(작게)/s3(크게), 색 c1~c4 만 허용
const TOK = /\uE000(s[13])?(c[1-4])?\uE001([^\uE000-\uE002]*)\uE002/g;
const stripTok = (t) => String(t || "").replace(TOK, "$3").replace(/[\uE000-\uE002]/g, "");
// 이미 esc 된 글에서 꾸밈 표시만 정해진 span 으로 바꿈 (다른 html 은 들어갈 수 없음)
const tokHtml = (h) => h.replace(TOK, (m, sz, c, t) => (sz || c ? `<span class="${[sz ? "fs-" + sz[1] : "", c ? "fc-" + c[1] : ""].filter(Boolean).join(" ")}">${t}</span>` : t)).replace(/[\uE000-\uE002]/g, "");

// 사진 표시를 뺀 글만 (목록 미리보기 · 기록장 내보내기용)
export const plainText = (body) => stripTok(String(body || "").split("\n").filter((l) => l.trim() !== MARK).join("\n")).replace(/\n{3,}/g, "\n\n").trim();

// 글 + 사진을 쓴 순서대로 html 로. 이어진 사진은 한 줄에 모음. 표시보다 사진이 많으면(예전 글) 남은 사진은 맨 뒤에
export function richHtml(body, photos = [], rowCls = "ph-row", textCls = "rt-p") {
  const lines = String(body || "").split("\n");
  const out = []; let text = [], pics = [], i = 0;
  const flushText = () => { const t = text.join("\n").trim(); if (stripTok(t).trim()) out.push(`<p class="${textCls}">${tokHtml(esc(t))}</p>`); text = []; };
  const flushPics = () => { if (pics.length) out.push(`<div class="${rowCls}" data-paths="${esc(pics.join("|"))}"></div>`); pics = []; };
  for (const l of lines) {
    if (l.trim() === MARK) { flushText(); if (i < photos.length) pics.push(photos[i++]); }
    else { flushPics(); text.push(l); }
  }
  flushText(); flushPics();
  if (i < photos.length) out.push(`<div class="${rowCls}" data-paths="${esc(photos.slice(i).join("|"))}"></div>`);
  return out.join("");
}

// 편집기: root 안에 글칸(textarea)과 사진을 번갈아 둠
export function makeRich(root, { placeholder = "", max = 10, onChange = () => {} } = {}) {
  let last = null, lastPos = 0;
  const grow = (ta) => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
  const textBox = (v = "") => {
    const ta = document.createElement("textarea");
    ta.className = "rt-ta"; ta.rows = 1; ta.value = v; ta.maxLength = 20000;
    ta.addEventListener("input", () => { grow(ta); onChange(); });
    const mark = () => { last = ta; lastPos = ta.selectionStart ?? ta.value.length; };
    ta.addEventListener("focus", mark); ta.addEventListener("keyup", mark); ta.addEventListener("click", mark); ta.addEventListener("blur", mark);
    return ta;
  };
  const photoBox = (p) => {
    const f = document.createElement("figure");
    f.className = "rt-ph"; f._p = p;
    f.innerHTML = `<img alt="" src="${esc(p.url || "")}"><button type="button" class="rt-x" aria-label="사진 빼기">✕</button>`;
    f.querySelector(".rt-x").addEventListener("click", () => remove(f));
    return f;
  };
  const blocks = () => [...root.children];
  const photos = () => blocks().filter((b) => b.tagName === "FIGURE").map((b) => b._p);
  const placeholders = () => { const tas = blocks().filter((b) => b.tagName === "TEXTAREA"); tas.forEach((t, k) => (t.placeholder = k === 0 && tas.length === 1 && !photos().length ? placeholder : "")); };
  // 사진 앞뒤에는 항상 글칸이 있게, 붙은 글칸은 합침
  function tidy() {
    let bs = blocks();
    for (let k = 0; k < bs.length - 1; k++) {
      if (bs[k].tagName === "TEXTAREA" && bs[k + 1].tagName === "TEXTAREA") {
        const a = bs[k], b = bs[k + 1];
        a.value = [a.value.replace(/\n+$/, ""), b.value.replace(/^\n+/, "")].filter(Boolean).join("\n");
        if (last === b) { last = a; lastPos = a.value.length; }
        b.remove(); bs = blocks(); k--;
      }
    }
    if (!bs.length || bs[0].tagName !== "TEXTAREA") root.prepend(textBox());
    bs = blocks();
    if (bs.at(-1).tagName !== "TEXTAREA") root.append(textBox());
    blocks().forEach((b, k, arr) => { if (b.tagName === "FIGURE" && arr[k + 1]?.tagName === "FIGURE") b.after(textBox()); });
    blocks().filter((b) => b.tagName === "TEXTAREA").forEach(grow);
    placeholders();
  }
  function remove(f) { const p = f._p; f.remove(); tidy(); onChange(p); }
  function set(body = "", list = []) {
    root.innerHTML = ""; last = null;
    const lines = String(body || "").split("\n");
    const marks = lines.filter((l) => l.trim() === MARK).length;
    let i = 0;
    // 예전 글(표시 없이 사진만 있는 글): 남는 사진은 글 맨 앞에
    for (; i < list.length - marks; i++) root.append(photoBox(list[i]));
    let buf = [];
    for (const l of lines) {
      if (l.trim() === MARK) { root.append(textBox(buf.join("\n"))); buf = []; if (i < list.length) root.append(photoBox(list[i++])); }
      else buf.push(l);
    }
    root.append(textBox(buf.join("\n")));
    tidy();
  }
  function insert(list) {
    const room = max - photos().length;
    list = list.slice(0, Math.max(0, room));
    if (!list.length) return 0;
    let ta = last && root.contains(last) ? last : blocks().filter((b) => b.tagName === "TEXTAREA").at(-1);
    const pos = ta === last ? Math.min(lastPos, ta.value.length) : ta.value.length;
    const before = ta.value.slice(0, pos).replace(/\n+$/, ""), after = ta.value.slice(pos).replace(/^\n+/, "");
    ta.value = before;
    let at = ta;
    for (const p of list) { const f = photoBox(p); at.after(f); at = f; }
    const next = textBox(after); at.after(next);
    tidy();
    last = next; lastPos = 0;
    setTimeout(() => { if (root.isConnected) next.focus({ preventScroll: true }); }, 30);
    onChange();
    return list.length;
  }
  // 저장할 값: body(사진 자리 표시 포함), items(쓴 순서의 사진)
  function get() {
    const parts = [], items = [];
    for (const b of blocks()) {
      if (b.tagName === "FIGURE") { parts.push(MARK); items.push(b._p); }
      else if (b.value.trim()) parts.push(b.value.replace(/\s+$/, ""));
    }
    return { body: parts.join("\n").trim(), items, text: parts.filter((x) => x !== MARK).join("\n").trim() };
  }
  // 사진 주소를 나중에 채울 때 (고치기)
  function refresh() { for (const b of blocks()) if (b.tagName === "FIGURE") b.querySelector("img").src = b._p.url || ""; }
  const focus = () => { const t = blocks().filter((b) => b.tagName === "TEXTAREA").at(-1); t?.focus(); };
  // 숨겨진 창에서 글을 채우면 글칸 높이를 못 재서 글이 잘려 보임 → 창이 보이거나 폭이 바뀌면 다시 맞춤
  let lastW = 0;
  new ResizeObserver(() => { const w = root.clientWidth; if (!w) { lastW = 0; return; } if (w !== lastW) { lastW = w; blocks().filter((b) => b.tagName === "TEXTAREA").forEach(grow); } }).observe(root);
  set("");
  return { set, get, insert, photos, refresh, focus, clear: () => set("") };
}

// ---------- 블로그용: 글씨 크기·색까지 되는 편집기 (contenteditable) ----------
// 같은 저장 모양(사진 자리 표시 + 꾸밈 표시)을 쓰고, 화면에는 정해진 class 의 span 만 둠
export function makeRichCE(root, { placeholder = "", max = 10, onChange = () => {} } = {}) {
  root.contentEditable = "true";
  root.classList.add("ce");
  root.dataset.ph = placeholder;
  let saved = null, prev = [];
  const figs = () => [...root.querySelectorAll(":scope > figure.rt-ph")];
  const photos = () => figs().map((f) => f._p);
  const line = (html) => { const d = document.createElement("div"); d.innerHTML = html || "<br>"; return d; };
  const photoBox = (p) => {
    const f = document.createElement("figure");
    f.className = "rt-ph"; f.contentEditable = "false"; f._p = p;
    f.innerHTML = `<img alt="" src="${esc(p.url || "")}"><button type="button" class="rt-x" aria-label="사진 빼기">✕</button>`;
    f.querySelector(".rt-x").addEventListener("click", () => { f.remove(); tidy(); changed(); });
    return f;
  };
  // 맨 위 칸은 모두 div(글줄) 또는 figure(사진)로 맞춤
  function tidy() {
    let stray = [];
    const wrap = (before) => { if (!stray.length) return; const d = document.createElement("div"); stray.forEach((n) => d.append(n)); root.insertBefore(d, before); stray = []; };
    for (const n of [...root.childNodes]) {
      if (n.nodeType === 1 && (n.tagName === "DIV" || n.tagName === "FIGURE" || n.tagName === "P")) { wrap(n); continue; }
      if (n.nodeType === 3 && !n.textContent.length) { n.remove(); continue; }
      stray.push(n);
    }
    wrap(null);
    if (!root.lastElementChild || root.lastElementChild.tagName === "FIGURE") root.append(line());
    figs().forEach((f) => { if (f.nextElementSibling?.tagName === "FIGURE") f.after(line()); });
    paintEmpty();
  }
  const paintEmpty = () => root.classList.toggle("empty", !figs().length && !root.textContent.replace(/\u200B/g, "").trim());
  function changed() {
    const now = photos();
    for (const p of prev) if (!now.includes(p)) onChange(p);
    prev = now; paintEmpty(); onChange();
  }
  root.addEventListener("input", () => { if (figs().length !== prev.length || [...root.childNodes].some((n) => n.nodeType === 3)) tidy(); changed(); });
  // 붙여넣기는 글자만
  root.addEventListener("paste", (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData("text/plain"); document.execCommand("insertText", false, t); });
  document.addEventListener("selectionchange", () => {
    const s = getSelection(); if (!s.rangeCount) return;
    const r = s.getRangeAt(0);
    if (root.contains(r.startContainer) && root.contains(r.endContainer)) saved = r.cloneRange();
  });
  const restore = () => {
    const s = getSelection();
    if (saved && root.contains(saved.startContainer)) { s.removeAllRanges(); s.addRange(saved); return saved; }
    const r = document.createRange(); const last = root.lastElementChild; r.selectNodeContents(last); r.collapse(false);
    s.removeAllRanges(); s.addRange(r); return r;
  };
  const topOf = (n) => { while (n && n.parentNode !== root) n = n.parentNode; return n; };

  function set(body = "", list = []) {
    root.innerHTML = "";
    const lines = String(body || "").split("\n");
    const marks = lines.filter((l) => l.trim() === MARK).length;
    let i = 0;
    for (; i < list.length - marks; i++) root.append(photoBox(list[i]));
    for (const l of lines) {
      if (l.trim() === MARK) { if (i < list.length) root.append(photoBox(list[i++])); }
      else root.append(line(tokHtml(esc(l))));
    }
    saved = null; tidy(); prev = photos();
  }
  function insert(list) {
    list = list.slice(0, Math.max(0, max - figs().length));
    if (!list.length) return 0;
    tidy();
    const r = restore();
    let top = topOf(r.startContainer);
    if (!top || top === root) top = root.lastElementChild;
    let at;
    if (top.tagName === "FIGURE") at = top;
    else {
      const tail = document.createRange(); tail.setStart(r.startContainer, r.startOffset); tail.setEnd(top, top.childNodes.length);
      const frag = tail.extractContents();
      const next = line(); next.innerHTML = ""; next.append(frag);
      if (!next.textContent.replace(/\u200B/g, "").length) next.innerHTML = "<br>";
      if (!top.textContent.replace(/\u200B/g, "").length) top.innerHTML = "<br>";
      top.after(next);
      at = top;
    }
    for (const p of list) { const f = photoBox(p); at.after(f); at = f; }
    let after = at.nextElementSibling;
    if (!after || after.tagName === "FIGURE") { after = line(); at.after(after); }
    tidy();
    const s = getSelection(), c = document.createRange(); c.setStart(after, 0); c.collapse(true); s.removeAllRanges(); s.addRange(c); saved = c.cloneRange();
    changed();
    return list.length;
  }
  // 글씨 꾸미기: kind "s"(1 작게·2 보통·3 크게) 또는 "c"(0 기본·1~4)
  function style(kind, v) {
    const cls = (kind === "s" ? "fs-" : "fc-") + v;
    const r = restore();
    const s = getSelection();
    if (r.collapsed) {
      const sp = document.createElement("span"); sp.className = cls; sp.textContent = "\u200B";
      r.insertNode(sp);
      const c = document.createRange(); c.setStart(sp.firstChild, 1); c.collapse(true); s.removeAllRanges(); s.addRange(c); saved = c.cloneRange();
      return;
    }
    const nodes = []; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (r.intersectsNode(n) && n.textContent.length && !n.parentElement.closest("figure")) nodes.push(n);
    const spans = [];
    for (let n of nodes) {
      let a = n === r.startContainer ? r.startOffset : 0, b = n === r.endContainer ? r.endOffset : n.textContent.length;
      if (a >= b) continue;
      if (b < n.textContent.length) n.splitText(b);
      if (a > 0) n = n.splitText(a);
      const sp = document.createElement("span"); sp.className = cls; n.before(sp); sp.append(n); spans.push(sp);
    }
    if (spans.length) { const c = document.createRange(); c.setStartBefore(spans[0]); c.setEndAfter(spans.at(-1)); s.removeAllRanges(); s.addRange(c); saved = c.cloneRange(); }
    onChange();
  }
  // 화면 → 저장 모양
  function get() {
    const lines = [], items = []; let cur = [], just = true;
    const flush = () => { lines.push(cur); cur = []; just = true; };
    const styleOf = (el, st) => {
      const c = el.classList; const n = { ...st };
      for (const k of c) { let m = /^fs-([123])$/.exec(k); if (m) n.s = m[1]; m = /^fc-([0-4])$/.exec(k); if (m) n.c = m[1]; }
      return n;
    };
    const walk = (node, st) => {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) { const t = ch.textContent.replace(/\u200B/g, "").replace(/[\uE000-\uE002\uFFFC]/g, ""); const parts = t.split("\n"); parts.forEach((p, k) => { if (k) flush(); if (p) { cur.push([p, st]); just = false; } }); continue; }
        if (ch.nodeType !== 1) continue;
        const tag = ch.tagName;
        if (tag === "BR") { flush(); continue; }
        if (tag === "FIGURE") { if (cur.length) flush(); if (ch._p) { lines.push(MARK); items.push(ch._p); } just = true; continue; }
        if (tag === "DIV" || tag === "P") { if (cur.length) flush(); walk(ch, st); if (cur.length || !just) flush(); continue; }
        walk(ch, tag === "SPAN" ? styleOf(ch, st) : st);
      }
    };
    walk(root, {});
    if (cur.length) flush();
    const code = (st) => (st.s === "1" || st.s === "3" ? "s" + st.s : "") + (st.c && st.c !== "0" ? "c" + st.c : "");
    const txt = lines.map((l) => {
      if (l === MARK) return MARK;
      const runs = [];
      for (const [t, st] of l) { const k = code(st); if (runs.length && runs.at(-1)[1] === k) runs.at(-1)[0] += t; else runs.push([t, k]); }
      return runs.map(([t, k]) => (k ? `\uE000${k}\uE001${t}\uE002` : t)).join("");
    });
    while (txt.length && !stripTok(txt.at(-1)).trim() && txt.at(-1) !== MARK) txt.pop();
    while (txt.length && !stripTok(txt[0]).trim() && txt[0] !== MARK) txt.shift();
    const body = txt.join("\n");
    return { body, items, text: plainText(body) };
  }
  function refresh() { for (const f of figs()) f.querySelector("img").src = f._p.url || ""; }
  set("");
  return { set, get, insert, photos, refresh, style, clear: () => set(""), focus: () => root.focus() };
}
