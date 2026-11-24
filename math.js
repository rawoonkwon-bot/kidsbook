// 바나나북코드 연산 프린트 — 초1~중3 단원·단계별 문제 생성기
// 같은 문제지 번호(code)를 넣으면 언제나 같은 문제가 다시 만들어져요. (정답 QR도 이 번호로 정답을 다시 계산)

// ---------- 난수 (번호 → 같은 문제) ----------
const SEED_CH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const newSeed = () => Array.from({ length: 4 }, () => SEED_CH[Math.floor(Math.random() * 32)]).join("");
const seedNum = (id, s) => { let h = 2166136261; for (const c of id + "|" + s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

let R = Math.random;
const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
const pick = (arr) => arr[Math.floor(R() * arr.length)];
const coin = (p = 0.5) => R() < p;
const nz = (a, b) => { let v = 0; while (!v) v = ri(a, b); return v; };
const sgn = () => (coin() ? 1 : -1);

// ---------- 수 ----------
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const lcm = (a, b) => Math.abs(a * b) / gcd(a, b);
const Q = (n, d = 1) => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d) || 1; return { n: n / g, d: d / g }; };
const qa = (x, y) => Q(x.n * y.d + y.n * x.d, x.d * y.d);
const qs = (x, y) => Q(x.n * y.d - y.n * x.d, x.d * y.d);
const qm = (x, y) => Q(x.n * y.n, x.d * y.d);
const qd = (x, y) => Q(x.n * y.d, x.d * y.n);
const qeq = (x, y) => x.n === y.n && x.d === y.d;
const qi = (x) => x.d === 1;
const MI = "−";
const neg = (s) => MI + s;
const N = (v) => (v < 0 ? MI + -v : String(v));
const F = (n, d) => `<span class="f"><i>${n}</i><i>${d}</i></span>`;
const BX = `<span class="bx"></span>`;
const PB = `( &emsp;&emsp; )`;
// 분수 → html. mixed=true면 대분수로
function fq(x, mixed = false) {
  if (x.d === 1) return N(x.n);
  const s = x.n < 0 ? MI : "", n = Math.abs(x.n);
  if (mixed && n > x.d) return s + Math.floor(n / x.d) + F(n % x.d, x.d);
  return s + F(n, x.d);
}
const fm = (w, n, d) => (w ? w : "") + F(n, d); // 대분수 모양
const paren = (s, v) => (v < 0 ? `(${s})` : s);
const sg = (v) => (v < 0 ? `(${MI}${-v})` : `(+${v})`);
const sgq = (x) => (x.n < 0 ? `(${fq(x)})` : `(+${fq(x)})`);
// 진분수(기약) 고르기
function pf(maxD, minD = 2) { for (;;) { const d = ri(minD, maxD), n = ri(1, d - 1); if (gcd(n, d) === 1) return [n, d]; } }

// 소수: 정수 v 와 소수 자리수 p → 문자열
function ds(v, p) {
  if (!p) return N(v);
  const s = String(Math.abs(v)).padStart(p + 1, "0");
  let i = s.slice(0, -p), f = s.slice(-p).replace(/0+$/, "");
  return (v < 0 ? MI : "") + i + (f ? "." + f : "");
}
// 자리 맞춰 보여줄 때 (뒤 0 유지)
function dsk(v, p) { const s = String(Math.abs(v)).padStart(p + 1, "0"); return s.slice(0, -p) + "." + s.slice(-p); }

// 받아올림·받아내림 횟수
const carries = (a, b) => { let c = 0, n = 0; while (a || b) { const t = (a % 10) + (b % 10) + c; c = t >= 10 ? 1 : 0; n += c; a = Math.floor(a / 10); b = Math.floor(b / 10); } return n; };
const borrows = (a, b) => { let c = 0, n = 0; while (a) { const t = (a % 10) - (b % 10) - c; c = t < 0 ? 1 : 0; n += c; a = Math.floor(a / 10); b = Math.floor(b / 10); } return n; };
const mulCarries = (a, k) => { let c = 0, n = 0; while (a) { const t = (a % 10) * k + c; c = Math.floor(t / 10); if (c) n++; a = Math.floor(a / 10); } return n; };

// ---------- 문제 모양 ----------
// p(q, a, v): q=가로 문제 html, a=정답 html, v=세로셈 정보
const P = (q, a, v) => ({ q, a, v });
const eq = (s) => `${s} =`;
const divAns = (q, r) => (r ? `${q} ··· ${r}` : String(q));
const DIVQ = (a, b) => `${a} ÷ ${b} = ${PB} ··· ${PB}`;
const vAdd = (a, b, op) => ({ t: "op", a: String(a), b: String(b), op });
const vDiv = (dv, dd) => ({ t: "div", dv: String(dv), dd: String(dd) });

// 다항식: 계수 Q, 항 키 "x2y1" (변수 순서 a b x y)
const VARS = ["a", "b", "x", "y"];
const key = (e) => VARS.map((v) => (e[v] ? v + e[v] : "")).join("");
const unkey = (k) => { const e = {}; for (const m of k.matchAll(/([abxy])(\d+)/g)) e[m[1]] = +m[2]; return e; };
const poly = (...terms) => { const p = new Map(); for (const [c, e] of terms) padd1(p, typeof c === "number" ? Q(c) : c, key(e || {})); return p; };
function padd1(p, c, k) { const o = p.get(k); const v = o ? qa(o, c) : c; if (v.n === 0) p.delete(k); else p.set(k, v); }
const padd = (A, B) => { const p = new Map(A); for (const [k, c] of B) padd1(p, c, k); return p; };
const pscale = (A, c) => { const p = new Map(); for (const [k, v] of A) padd1(p, qm(v, typeof c === "number" ? Q(c) : c), k); return p; };
const psub = (A, B) => padd(A, pscale(B, -1));
function pmul(A, B) {
  const p = new Map();
  for (const [k1, c1] of A) for (const [k2, c2] of B) {
    const e1 = unkey(k1), e2 = unkey(k2), e = {};
    for (const v of VARS) if ((e1[v] || 0) + (e2[v] || 0)) e[v] = (e1[v] || 0) + (e2[v] || 0);
    padd1(p, qm(c1, c2), key(e));
  }
  return p;
}
const ppow = (A, n) => { let p = poly([1]); for (let i = 0; i < n; i++) p = pmul(p, A); return p; };
const deg = (k) => Object.values(unkey(k)).reduce((a, b) => a + b, 0);
const SUP = (n) => (n > 1 ? `<sup>${n}</sup>` : "");
const vh = (e) => VARS.filter((v) => e[v]).sort((a, b) => ORD.indexOf(a) - ORD.indexOf(b)).map((v) => v + SUP(e[v])).join("");
const ORD = ["a", "b", "x", "y"];
// 항 하나 html (first=맨 앞 항인지)
function termH(c, e, first) {
  const v = vh(e), neg_ = c.n < 0, ab = Q(Math.abs(c.n), c.d);
  let body;
  if (!v) body = fq(ab);
  else if (ab.n === 1 && ab.d === 1) body = v;
  else body = (ab.d === 1 ? ab.n : F(ab.n, ab.d)) + v;
  return first ? (neg_ ? MI : "") + body : (neg_ ? ` ${MI} ` : " + ") + body;
}
function ph(A, order) {
  if (!A.size) return "0";
  const ks = [...A.keys()].sort(order || ((a, b) => deg(b) - deg(a) || cmpVars(a, b)));
  return ks.map((k, i) => termH(A.get(k), unkey(k), i === 0)).join("");
}
const cmpVars = (a, b) => { const ea = unkey(a), eb = unkey(b); for (const v of ["a", "x", "b", "y"]) if ((ea[v] || 0) !== (eb[v] || 0)) return (eb[v] || 0) - (ea[v] || 0); return 0; };
// 정수 계수 일차식 등 간단 표기: [[계수, "x"], [상수, ""]]
function lin(terms) {
  let out = "", first = true;
  for (const [c, v] of terms) {
    const cc = typeof c === "number" ? Q(c) : c;
    if (!cc.n) continue;
    out += termH(cc, v ? unkey(v.replace(/([abxy])(\d*)/g, (m, x, n) => x + (n || 1))) : {}, first);
    first = false;
  }
  return out || "0";
}
const mono = (c, e) => termH(typeof c === "number" ? Q(c) : c, e, true);

// 근호
const RT = (r) => `√<span class="rt">${r}</span>`;
function sqf(n) { let c = 1, r = n; for (let k = 2; k * k <= r; k++) while (r % (k * k) === 0) { r /= k * k; c *= k; } return [c, r]; } // √n = c√r
// 근호식 S: Map r → Q (r=1은 유리수)
const sur = (...t) => { const m = new Map(); for (const [c, r] of t) sadd1(m, typeof c === "number" ? Q(c) : c, r); return m; };
function sadd1(m, c, r) { const [k, s] = sqf(r); c = qm(c, Q(k)); const o = m.get(s); const v = o ? qa(o, c) : c; if (v.n === 0) m.delete(s); else m.set(s, v); }
const sadd = (A, B) => { const m = new Map(A); for (const [r, c] of B) sadd1(m, c, r); return m; };
function smul(A, B) { const m = new Map(); for (const [r1, c1] of A) for (const [r2, c2] of B) sadd1(m, qm(c1, c2), r1 * r2); return m; }
function sTerm(c, r, first) {
  const ng = c.n < 0, n = Math.abs(c.n), d = c.d;
  let body;
  if (r === 1) body = fq(Q(n, d));
  else { const top = (n === 1 ? "" : n) + RT(r); body = d === 1 ? top : F(top, d); }
  return first ? (ng ? MI : "") + body : (ng ? ` ${MI} ` : " + ") + body;
}
function sh(A) {
  if (!A.size) return "0";
  const ks = [...A.keys()].sort((a, b) => (a === 1 ? 1 : b === 1 ? -1 : a - b));
  return ks.map((r, i) => sTerm(A.get(r), r, i === 0)).join("");
}

// 연립방정식 모양
const SYS = (a, b) => `<span class="sys"><span>${a}</span><span>${b}</span></span>`;

// 식 계산기 (초5 혼합 계산): 토큰 → 값, 중간값이 모두 0 이상 정수인지 확인
function evalExpr(tokens) {
  let i = 0, ok = true;
  const num = () => { const t = tokens[i++]; if (t === "(") { const v = add(); i++; return v; } return Q(t); };
  const mul = () => { let v = num(); while (tokens[i] === "×" || tokens[i] === "÷") { const op = tokens[i++]; const w = num(); v = op === "×" ? qm(v, w) : w.n === 0 ? (ok = false, Q(0)) : qd(v, w); if (!qi(v) || v.n < 0) ok = false; } return v; };
  const add = () => { let v = mul(); while (tokens[i] === "+" || tokens[i] === "−") { const op = tokens[i++]; const w = mul(); v = op === "+" ? qa(v, w) : qs(v, w); if (!qi(v) || v.n < 0) ok = false; } return v; };
  const v = add();
  return ok ? v.n : null;
}
const exprH = (t) => t.join(" ").replace(/\( /g, "(").replace(/ \)/g, ")");

// 여러 모양 중 하나 고르기
const any = (...fs) => () => pick(fs)();


// ---------- 단계 정의 도우미 ----------
// S(제목, 문제 만들기, 옵션) — 옵션: n 문제 수, cols 가로 줄 칸, inst 안내, v 세로셈 가능, vn/vc 세로셈 문제 수·칸, big 풀이 칸 크게
const S = (t, mk, o = {}) => ({ t, mk, ...o });
const josa = (n, a, b) => ([0, 1, 3, 6, 7, 8].includes(n % 10) ? a : b); // 받침 있으면 a
const add2 = (a, b) => P(eq(`${a} + ${b}`), a + b, vAdd(a, b, "+"));
const sub2 = (a, b) => P(eq(`${a} − ${b}`), a - b, vAdd(a, b, "−"));
const mul2 = (a, b) => P(eq(`${a} × ${b}`), a * b, vAdd(a, b, "×"));
const divX = (a, b) => P(eq(`${a} ÷ ${b}`), a / b, vDiv(b, a)); // 나누어떨어짐
const divR = (a, b) => P(DIVQ(a, b), divAns(Math.floor(a / b), a % b), vDiv(b, a));
const mixRaw = (n, d) => (n < d ? F(n, d) : n % d === 0 ? String(n / d) : Math.floor(n / d) + F(n % d, d)); // 약분하지 않음 (4학년)
const dPad = (a, pa, b, pb) => { const p = Math.max(pa, pb); const f = (v, q) => (q ? dsk(v, q) : String(v)) + (q < p ? "&nbsp;".repeat(p - q + (q ? 0 : 1)) : ""); return [f(a, pa), f(b, pb)]; };
const decOp = (a, pa, b, pb, op) => {
  const p = Math.max(pa, pb), A = a * 10 ** (p - pa), B = b * 10 ** (p - pb), r = op === "+" ? A + B : A - B;
  const [x, y] = dPad(a, pa, b, pb);
  return P(eq(`${ds(a, pa)} ${op} ${ds(b, pb)}`), ds(r, p), { t: "op", a: x, b: y, op });
};

const E1 = [
  { sem: 1, name: "덧셈과 뺄셈", steps: [
    S("가르기와 모으기", () => {
      if (coin()) { const a = ri(1, 8), b = ri(1, 9 - a); return [`m${a},${b}`, P(`${a}${josa(a, "과", "와")} ${b}${josa(b, "을", "를")} 모으면 ${BX}`, a + b)]; }
      const n = ri(2, 9), a = ri(1, n - 1); return [`g${n},${a}`, P(`${n}${josa(n, "은", "는")} ${a}${josa(a, "과", "와")} ${BX}`, n - a)];
    }, { n: 24, cols: 3, inst: "□ 안에 알맞은 수를 쓰세요." }),
    S("합이 9까지인 덧셈", () => { const a = ri(1, 8), b = ri(1, 9 - a); return [`${a}+${b}`, P(eq(`${a} + ${b}`), a + b)]; }, { n: 30, cols: 3 }),
    S("9까지의 뺄셈", () => { const a = ri(2, 9), b = ri(1, a - 1); return [`${a}-${b}`, P(eq(`${a} − ${b}`), a - b)]; }, { n: 30, cols: 3 }),
    S("0이 있는 덧셈과 뺄셈", () => { const a = ri(1, 9), f = ri(0, 3); const q = [`${a} + 0`, `0 + ${a}`, `${a} − 0`, `${a} − ${a}`][f]; return [q, P(eq(q), [a, a, a, 0][f])]; }, { n: 30, cols: 3 }),
  ] },
  { sem: 2, name: "덧셈과 뺄셈", steps: [
    S("10 만들기", () => {
      const a = ri(1, 9), f = ri(0, 2);
      const q = [`${a} + ${BX} = 10`, `${BX} + ${a} = 10`, `10은 ${a}${josa(a, "과", "와")} ${BX}`][f];
      return [q, P(q, 10 - a)];
    }, { n: 24, cols: 3, inst: "□ 안에 알맞은 수를 쓰세요." }),
    S("10에서 빼기", () => {
      if (coin(0.6)) { const a = ri(1, 8), b = ri(1, 9 - a); return [`${a}-${b}`, P(eq(`10 − ${a} − ${b}`), 10 - a - b)]; }
      const a = ri(1, 9); return coin() ? [`t${a}`, P(eq(`10 − ${a}`), 10 - a)] : [`b${a}`, P(`10 − ${BX} = ${a}`, 10 - a)];
    }, { n: 30, cols: 3 }),
    S("세 수의 계산", () => {
      const a = ri(1, 9), b = ri(1, 9), c = ri(1, 9), o1 = pick(["+", "−"]), o2 = pick(["+", "−"]);
      const m = o1 === "+" ? a + b : a - b, r = o2 === "+" ? m + c : m - c;
      if (m < 0 || m > 18 || r < 0 || r > 18) return [null];
      return [`${a}${o1}${b}${o2}${c}`, P(eq(`${a} ${o1} ${b} ${o2} ${c}`), r)];
    }, { n: 30, cols: 3 }),
    S("(몇) + (몇) 받아올림", () => { const a = ri(2, 9), b = ri(2, 9); if (a + b < 11) return [null]; return [`${a}+${b}`, add2(a, b)]; }, { n: 24, cols: 3, v: 1 }),
    S("(십몇) − (몇) 받아내림", () => { const a = ri(11, 18), b = ri(2, 9); if (a % 10 >= b) return [null]; return [`${a}-${b}`, sub2(a, b)]; }, { n: 30, cols: 3, v: 1 }),
    S("(몇십몇) ± (몇) 받아올림·받아내림 없음", () => {
      const a = ri(11, 98), b = ri(1, 9);
      if (coin()) { if ((a % 10) + b > 9) return [null]; return [`${a}+${b}`, add2(a, b)]; }
      if (a % 10 < b) return [null]; return [`${a}-${b}`, sub2(a, b)];
    }, { n: 24, cols: 3, v: 1 }),
    S("(몇십몇) ± (몇십몇) 받아올림·받아내림 없음", () => {
      const a = ri(10, 98), b = ri(10, 89);
      if (coin()) { if (carries(a, b) || a + b > 99) return [null]; return [`${a}+${b}`, add2(a, b)]; }
      if (b >= a || borrows(a, b)) return [null]; return [`${a}-${b}`, sub2(a, b)];
    }, { n: 24, cols: 3, v: 1 }),
  ] },
];

const E2 = [
  { sem: 1, name: "덧셈과 뺄셈", steps: [
    S("두 자리 수 + 한 자리 수 (받아올림)", () => { const a = ri(11, 89), b = ri(2, 9); if ((a % 10) + b < 10 || a + b > 99) return [null]; return [`${a}+${b}`, add2(a, b)]; }, { n: 24, cols: 3, v: 1 }),
    S("몇십 + 몇십", () => { const a = ri(1, 8) * 10, b = ri(1, 9) * 10; if (a + b > 90) return [null]; return [`${a}+${b}`, add2(a, b)]; }, { n: 24, cols: 3, v: 1 }),
    S("두 자리 수 + 두 자리 수 (받아올림 1번)", () => { const a = ri(11, 89), b = ri(11, 89); if (carries(a, b) !== 1 || a + b > 99) return [null]; return [`${a}+${b}`, add2(a, b)]; }, { v: 1 }),
    S("두 자리 수 + 두 자리 수 (받아올림 2번)", () => { const a = ri(15, 99), b = ri(15, 99); if (carries(a, b) !== 2) return [null]; return [`${a}+${b}`, add2(a, b)]; }, { v: 1 }),
    S("두 자리 수 − 한 자리 수 (받아내림)", () => { const a = ri(20, 98), b = ri(2, 9); if (a % 10 >= b) return [null]; return [`${a}-${b}`, sub2(a, b)]; }, { n: 24, cols: 3, v: 1 }),
    S("몇십 − 두 자리 수", () => { const a = ri(2, 9) * 10, b = ri(11, a - 1); if (b % 10 === 0) return [null]; return [`${a}-${b}`, sub2(a, b)]; }, { v: 1 }),
    S("두 자리 수 − 두 자리 수 (받아내림)", () => { const a = ri(21, 98), b = ri(11, a - 1); if (borrows(a, b) !== 1 || a % 10 === 0) return [null]; return [`${a}-${b}`, sub2(a, b)]; }, { v: 1 }),
    S("세 수의 덧셈과 뺄셈", () => {
      const a = ri(10, 60), b = ri(10, 50), c = ri(5, 40), o1 = pick(["+", "−"]), o2 = pick(["+", "−"]);
      const m = o1 === "+" ? a + b : a - b, r = o2 === "+" ? m + c : m - c;
      if (m < 0 || m > 99 || r < 0 || r > 99) return [null];
      return [`${a}${o1}${b}${o2}${c}`, P(eq(`${a} ${o1} ${b} ${o2} ${c}`), r)];
    }),
  ] },
  { sem: 2, name: "곱셈구구", steps: [
    ...[[2, 5], [3, 6], [4, 8], [7, 9]].map(([x, y]) => S(`${x}단과 ${y}단`, () => { const d = coin() ? x : y, k = ri(1, 9); return coin(0.7) ? [`${d}x${k}`, P(eq(`${d} × ${k}`), d * k)] : [`${k}x${d}`, P(eq(`${k} × ${d}`), d * k)]; }, { n: 30, cols: 3 })),
    S("1단과 0의 곱", () => { const k = ri(0, 9), d = ri(0, 1); return coin() ? [`${d}x${k}`, P(eq(`${d} × ${k}`), d * k)] : [`${k}x${d}`, P(eq(`${k} × ${d}`), d * k)]; }, { n: 30, cols: 3 }),
    S("곱셈구구 섞기", () => { const a = ri(2, 9), b = ri(1, 9); return [`${a}x${b}`, P(eq(`${a} × ${b}`), a * b)]; }, { n: 30, cols: 3 }),
    S("□ 안에 알맞은 수", () => { const a = ri(2, 9), b = ri(1, 9); return coin() ? [`${a}xb${b}`, P(`${a} × ${BX} = ${a * b}`, b)] : [`b${b}x${a}`, P(`${BX} × ${a} = ${a * b}`, b)]; }, { n: 30, cols: 3, inst: "□ 안에 알맞은 수를 쓰세요." }),
  ] },
];

const E3 = [
  { sem: 1, name: "덧셈과 뺄셈", steps: [
    S("세 자리 수 + 세 자리 수 (받아올림 없음)", () => { const a = ri(101, 888), b = ri(101, 888); if (carries(a, b) || a + b > 999) return [null]; return [`${a}+${b}`, add2(a, b)]; }, { v: 1 }),
    S("세 자리 수 + 세 자리 수 (받아올림 1번)", () => { const a = ri(101, 899), b = ri(101, 899); if (carries(a, b) !== 1 || a + b > 999) return [null]; return [`${a}+${b}`, add2(a, b)]; }, { v: 1 }),
    S("세 자리 수 + 세 자리 수 (받아올림 2~3번)", () => { const a = ri(105, 999), b = ri(105, 999); if (carries(a, b) < 2) return [null]; return [`${a}+${b}`, add2(a, b)]; }, { v: 1 }),
    S("세 자리 수 − 세 자리 수 (받아내림 없음)", () => { const a = ri(201, 999), b = ri(101, a - 100); if (borrows(a, b)) return [null]; return [`${a}-${b}`, sub2(a, b)]; }, { v: 1 }),
    S("세 자리 수 − 세 자리 수 (받아내림 1번)", () => { const a = ri(201, 999), b = ri(101, a - 50); if (borrows(a, b) !== 1) return [null]; return [`${a}-${b}`, sub2(a, b)]; }, { v: 1 }),
    S("세 자리 수 − 세 자리 수 (받아내림 2번)", () => { const a = ri(301, 999), b = ri(101, a - 100); if (borrows(a, b) !== 2) return [null]; return [`${a}-${b}`, sub2(a, b)]; }, { v: 1 }),
  ] },
  { sem: 1, name: "나눗셈", steps: [
    S("곱셈구구로 몫 구하기", () => { const b = ri(2, 9), q = ri(1, 9); return [`${b * q}/${b}`, P(eq(`${b * q} ÷ ${b}`), q)]; }, { n: 30, cols: 3 }),
    S("곱셈과 나눗셈의 관계 (□ 구하기)", () => { const b = ri(2, 9), q = ri(1, 9), c = b * q; return coin() ? [`a${c},${b}`, P(`${BX} ÷ ${b} = ${q}`, c)] : [`b${c},${q}`, P(`${c} ÷ ${BX} = ${q}`, b)]; }, { n: 30, cols: 3, inst: "□ 안에 알맞은 수를 쓰세요." }),
  ] },
  { sem: 1, name: "곱셈", steps: [
    S("몇십 × 몇", () => { const a = ri(1, 9) * 10, b = ri(2, 9); return [`${a}x${b}`, mul2(a, b)]; }, { n: 24, cols: 3, v: 1 }),
    S("두 자리 수 × 한 자리 수 (올림 없음)", () => { const a = ri(11, 99), b = ri(2, 4); if (a % 10 === 0 || mulCarries(a, b)) return [null]; return [`${a}x${b}`, mul2(a, b)]; }, { v: 1 }),
    S("두 자리 수 × 한 자리 수 (올림 1번)", () => { const a = ri(11, 99), b = ri(2, 9); if (a % 10 === 0 || mulCarries(a, b) !== 1) return [null]; return [`${a}x${b}`, mul2(a, b)]; }, { v: 1 }),
    S("두 자리 수 × 한 자리 수 (올림 2번)", () => { const a = ri(13, 99), b = ri(2, 9); if (a % 10 === 0 || mulCarries(a, b) !== 2) return [null]; return [`${a}x${b}`, mul2(a, b)]; }, { v: 1 }),
  ] },
  { sem: 2, name: "곱셈", steps: [
    S("세 자리 수 × 한 자리 수 (올림 없음)", () => { const a = ri(111, 444), b = ri(2, 4); if (a % 10 === 0 || mulCarries(a, b)) return [null]; return [`${a}x${b}`, mul2(a, b)]; }, { v: 1 }),
    S("세 자리 수 × 한 자리 수 (올림 있음)", () => { const a = ri(102, 987), b = ri(2, 9); if (a % 10 === 0 || !mulCarries(a, b)) return [null]; return [`${a}x${b}`, mul2(a, b)]; }, { v: 1 }),
    S("몇십 × 몇십", () => { const a = ri(1, 9) * 10, b = ri(2, 9) * 10; return [`${a}x${b}`, mul2(a, b)]; }, { n: 24, cols: 3, v: 1 }),
    S("두 자리 수 × 몇십", () => { const a = ri(11, 99), b = ri(2, 9) * 10; if (a % 10 === 0) return [null]; return [`${a}x${b}`, mul2(a, b)]; }, { v: 1 }),
    S("두 자리 수 × 두 자리 수", () => { const a = ri(12, 98), b = ri(12, 98); if (a % 10 === 0 || b % 10 === 0) return [null]; return [`${a}x${b}`, mul2(a, b)]; }, { n: 16, v: 1, vn: 15, vc: 3, big: 1 }),
  ] },
  { sem: 2, name: "나눗셈", steps: [
    S("몇십 ÷ 몇", () => { const a = ri(2, 9) * 10, b = ri(2, 9); if (a % b || a / b < 10) return [null]; return [`${a}/${b}`, divX(a, b)]; }, { n: 16, v: 1, vn: 16 }),
    S("두 자리 수 ÷ 한 자리 수 (나머지 없음)", () => { const b = ri(2, 9), q = ri(10, 49), a = b * q; if (a > 99) return [null]; return [`${a}/${b}`, divX(a, b)]; }, { n: 16, v: 1, vn: 16 }),
    S("두 자리 수 ÷ 한 자리 수 (나머지 있음)", () => { const b = ri(2, 9), q = ri(10, 49), r = ri(1, b - 1), a = b * q + r; if (a > 99) return [null]; return [`${a}/${b}`, divR(a, b)]; }, { n: 16, v: 1, vn: 16 }),
    S("세 자리 수 ÷ 한 자리 수 (나머지 없음)", () => { const b = ri(2, 9), q = ri(12, 499), a = b * q; if (a < 100 || a > 999) return [null]; return [`${a}/${b}`, divX(a, b)]; }, { n: 16, v: 1, vn: 12 }),
    S("세 자리 수 ÷ 한 자리 수 (나머지 있음)", () => { const b = ri(2, 9), q = ri(12, 499), r = ri(1, b - 1), a = b * q + r; if (a < 100 || a > 999) return [null]; return [`${a}/${b}`, divR(a, b)]; }, { n: 16, v: 1, vn: 12 }),
    S("나눗셈하고 검산하기", () => {
      const b = ri(3, 9), q = ri(11, 99), r = ri(1, b - 1), a = b * q + r; if (a > 999) return [null];
      return [`${a}/${b}`, P(`${DIVQ(a, b)}<br><small>검산</small> ${b} × ${PB} + ${PB} = ${PB}`, `${q} ··· ${r} / ${b} × ${q} + ${r} = ${a}`)];
    }, { n: 12, inst: "나눗셈을 하고 맞게 계산했는지 확인해 보세요." }),
  ] },
];

const E4 = [
  { sem: 1, name: "곱셈과 나눗셈", steps: [
    S("세 자리 수 × 몇십", () => { const a = ri(101, 999), b = ri(2, 9) * 10; if (a % 10 === 0) return [null]; return [`${a}x${b}`, mul2(a, b)]; }, { v: 1 }),
    S("세 자리 수 × 두 자리 수", () => { const a = ri(102, 999), b = ri(12, 99); if (a % 10 === 0 || b % 10 === 0) return [null]; return [`${a}x${b}`, mul2(a, b)]; }, { n: 16, v: 1, vn: 12, vc: 3, big: 1 }),
    S("몇백몇십 ÷ 몇십", () => { const b = ri(2, 9) * 10, a = ri(11, 99) * 10; if (a / b >= 10 || a < b) return [null]; return [`${a}/${b}`, divR(a, b)]; }, { n: 16, v: 1, vn: 16 }),
    S("두 자리 수 ÷ 두 자리 수", () => { const b = ri(11, 49), a = ri(b, 99); if (a === b) return [null]; return [`${a}/${b}`, divR(a, b)]; }, { n: 16, v: 1, vn: 16 }),
    S("세 자리 수 ÷ 두 자리 수 (몫이 한 자리)", () => { const b = ri(12, 99), a = ri(100, 999); if (a >= b * 10 || a < b * 2) return [null]; return [`${a}/${b}`, divR(a, b)]; }, { n: 16, v: 1, vn: 12 }),
    S("세 자리 수 ÷ 두 자리 수 (몫이 두 자리)", () => { const b = ri(11, 49), a = ri(b * 10, 999); return [`${a}/${b}`, divR(a, b)]; }, { n: 12, v: 1, vn: 9, vc: 3 }),
    S("나눗셈하고 검산하기", () => {
      const b = ri(12, 60), q = ri(3, 40), r = ri(1, b - 1), a = b * q + r; if (a < 100 || a > 999) return [null];
      return [`${a}/${b}`, P(`${DIVQ(a, b)}<br><small>검산</small> ${b} × ${PB} + ${PB} = ${PB}`, `${q} ··· ${r} / ${b} × ${q} + ${r} = ${a}`)];
    }, { n: 12, inst: "나눗셈을 하고 맞게 계산했는지 확인해 보세요." }),
  ] },
  { sem: 2, name: "분수의 덧셈과 뺄셈", steps: [
    S("진분수의 덧셈 (합이 1보다 작음)", () => { const d = ri(3, 12), a = ri(1, d - 2), b = ri(1, d - 1 - a); return [`${a}+${b}/${d}`, P(eq(`${F(a, d)} + ${F(b, d)}`), F(a + b, d))]; }),
    S("진분수의 덧셈 (합이 1보다 큼)", () => { const d = ri(3, 12), a = ri(1, d - 1), b = ri(1, d - 1); if (a + b <= d) return [null]; return [`${a}+${b}/${d}`, P(eq(`${F(a, d)} + ${F(b, d)}`), mixRaw(a + b, d))]; }),
    S("1에서 진분수 빼기", () => { const d = ri(2, 12), a = ri(1, d - 1), w = coin(0.6) ? 1 : ri(2, 4); return [`${w}-${a}/${d}`, P(eq(`${w} − ${F(a, d)}`), mixRaw(w * d - a, d))]; }),
    S("대분수의 덧셈", () => { const d = ri(3, 12), a = ri(1, d - 1), b = ri(1, d - 1), x = ri(1, 6), y = ri(1, 6); return [`${x}${a}+${y}${b}/${d}`, P(eq(`${fm(x, a, d)} + ${fm(y, b, d)}`), mixRaw((x + y) * d + a + b, d))]; }),
    S("대분수의 뺄셈 (받아내림 없음)", () => { const d = ri(3, 12), a = ri(2, d - 1), b = ri(1, a - 1), x = ri(2, 8), y = ri(1, x - 1); return [`${x}${a}-${y}${b}/${d}`, P(eq(`${fm(x, a, d)} − ${fm(y, b, d)}`), mixRaw((x - y) * d + a - b, d))]; }),
    S("받아내림이 있는 대분수의 뺄셈", () => {
      const d = ri(3, 12), b = ri(1, d - 1), x = ri(2, 8), y = ri(1, x - 1);
      if (coin(0.3)) return [`${x}-${y}${b}/${d}`, P(eq(`${x} − ${fm(y, b, d)}`), mixRaw((x - y) * d - b, d))];
      const a = ri(1, d - 1); if (a >= b) return [null];
      return [`${x}${a}-${y}${b}/${d}`, P(eq(`${fm(x, a, d)} − ${fm(y, b, d)}`), mixRaw((x - y) * d + a - b, d))];
    }),
  ] },
  { sem: 2, name: "소수의 덧셈과 뺄셈", steps: [
    S("소수 한 자리 수의 덧셈과 뺄셈", () => { const a = ri(1, 99), b = ri(1, 99); if (a % 10 === 0 || b % 10 === 0) return [null]; if (coin()) return [`${a}+${b}`, decOp(a, 1, b, 1, "+")]; if (b >= a) return [null]; return [`${a}-${b}`, decOp(a, 1, b, 1, "−")]; }, { v: 1 }),
    S("소수 두 자리 수의 덧셈과 뺄셈", () => { const a = ri(11, 999), b = ri(11, 999); if (a % 10 === 0 || b % 10 === 0) return [null]; if (coin()) return [`${a}+${b}`, decOp(a, 2, b, 2, "+")]; if (b >= a) return [null]; return [`${a}-${b}`, decOp(a, 2, b, 2, "−")]; }, { v: 1 }),
    S("자릿수가 다른 소수의 덧셈과 뺄셈", () => {
      const a = ri(11, 99), b = ri(101, 999); if (a % 10 === 0 || b % 10 === 0) return [null];
      const sw = coin(), [x, px, y, py] = sw ? [b, 2, a, 1] : [a, 1, b, 2];
      if (coin()) return [`${x},${px}+${y}`, decOp(x, px, y, py, "+")];
      if (x * 10 ** (2 - px) <= y * 10 ** (2 - py)) return [null];
      return [`${x},${px}-${y}`, decOp(x, px, y, py, "−")];
    }, { v: 1 }),
    S("받아올림·받아내림이 많은 소수의 계산", () => {
      const a = ri(1001, 9999), b = ri(101, 9999); if (a % 10 === 0 || b % 10 === 0) return [null];
      if (coin()) { if (carries(a, b) < 2) return [null]; return [`${a}+${b}`, decOp(a, 2, b, 2, "+")]; }
      if (b >= a || borrows(a, b) < 2) return [null]; return [`${a}-${b}`, decOp(a, 2, b, 2, "−")];
    }, { v: 1 }),
  ] },
];

// 혼합 계산 식 만들기: 틀에 숫자를 넣고, 중간값이 모두 0 이상 정수인 것만
const mixT = (...tpls) => () => {
  const t = pick(tpls)();
  const v = evalExpr(t);
  if (v == null || v > 999) return [null];
  return [t.join(""), P(eq(exprH(t)), v)];
};
const sq = () => ri(2, 9), dd = () => ri(10, 99);
const divisors = (n) => { const o = []; for (let k = 1; k <= n; k++) if (n % k === 0) o.push(k); return o; };
const ans = (x) => fq(x, true);

const E5 = [
  { sem: 1, name: "자연수의 혼합 계산", steps: [
    S("덧셈과 뺄셈이 섞인 식", mixT(() => [dd(), "+", dd(), "−", dd()], () => [dd(), "−", dd(), "+", dd()], () => [dd(), "−", dd(), "−", ri(1, 30)], () => [dd(), "+", dd(), "−", dd(), "+", ri(1, 30)])),
    S("곱셈과 나눗셈이 섞인 식", mixT(() => [ri(2, 30), "×", sq(), "÷", sq()], () => [ri(12, 90), "÷", sq(), "×", sq()], () => [ri(20, 99), "÷", sq(), "÷", sq()], () => [sq(), "×", sq(), "×", ri(2, 5), "÷", sq()])),
    S("덧셈, 뺄셈, 곱셈이 섞인 식", mixT(() => [dd(), "+", sq(), "×", sq(), "−", dd()], () => [dd(), "−", sq(), "×", sq()], () => [sq(), "×", ri(2, 12), "−", dd(), "+", ri(1, 30)], () => [dd(), "+", sq(), "×", sq()])),
    S("덧셈, 뺄셈, 나눗셈이 섞인 식", mixT(() => [dd(), "−", ri(12, 90), "÷", sq(), "+", ri(1, 30)], () => [ri(12, 90), "÷", sq(), "+", dd(), "−", ri(1, 30)], () => [dd(), "+", ri(12, 90), "÷", sq()], () => [dd(), "−", ri(12, 90), "÷", sq()])),
    S("괄호가 있는 식", mixT(() => ["(", dd(), "+", dd(), ")", "×", sq(), "−", dd()], () => [sq(), "×", "(", dd(), "−", dd(), ")", "÷", sq()], () => [dd(), "−", "(", ri(5, 40), "+", ri(5, 40), ")", "÷", sq()], () => ["(", dd(), "−", ri(5, 40), ")", "÷", sq(), "+", dd()], () => [ri(100, 300), "−", sq(), "×", "(", ri(2, 20), "+", sq(), ")"]), { n: 16 }),
    S("사칙 계산이 모두 섞인 식", mixT(() => [dd(), "+", sq(), "×", ri(2, 20), "÷", sq(), "−", ri(1, 40)], () => ["(", dd(), "−", ri(5, 40), ")", "×", sq(), "+", ri(12, 90), "÷", sq()], () => [ri(100, 300), "−", ri(12, 90), "÷", sq(), "×", sq(), "+", dd()], () => [sq(), "×", "(", dd(), "+", dd(), ")", "÷", sq(), "−", ri(1, 40)]), { n: 16 }),
  ] },
  { sem: 1, name: "약수와 배수", steps: [
    S("약수 구하기", () => { const n = ri(6, 72); if (divisors(n).length < 4) return [null]; return [`${n}`, P(`${n}의 약수`, divisors(n).join(", "))]; }, { n: 16, inst: "약수를 모두 쓰세요." }),
    S("배수 구하기", () => { const n = ri(2, 19); return [`${n}`, P(`${n}의 배수 (작은 수부터 5개)`, [1, 2, 3, 4, 5].map((k) => k * n).join(", "))]; }, { n: 16, inst: "배수를 가장 작은 수부터 5개 쓰세요." }),
    S("최대공약수", () => { const g = ri(2, 12), a = ri(2, 9) * g, b = ri(2, 9) * g; if (a === b || a > 99 || b > 99) return [null]; return [`${Math.min(a, b)},${Math.max(a, b)}`, P(`(${a}, ${b})`, gcd(a, b))]; }, { inst: "두 수의 최대공약수를 구하세요." }),
    S("최소공배수", () => { const a = ri(4, 30), b = ri(4, 30); if (a === b || gcd(a, b) === 1 && coin(0.6) || lcm(a, b) > 200) return [null]; return [`${Math.min(a, b)},${Math.max(a, b)}`, P(`(${a}, ${b})`, lcm(a, b))]; }, { inst: "두 수의 최소공배수를 구하세요." }),
  ] },
  { sem: 1, name: "약분과 통분", steps: [
    S("약분하기 (□ 구하기)", () => { const [n, d] = pf(9), k = ri(2, 8), m = pick(divisors(k).filter((x) => x < k)); return [`${n}/${d}*${k}/${m}`, P(`${F(n * k, d * k)} = ${F(BX, d * m)}`, n * m)]; }, { inst: "□ 안에 알맞은 수를 쓰세요." }),
    S("기약분수로 나타내기", () => { const [n, d] = pf(12), k = ri(2, 9); if (d * k > 120) return [null]; return [`${n}/${d}*${k}`, P(eq(F(n * k, d * k)), F(n, d))]; }, { inst: "기약분수로 나타내세요." }),
    S("통분하기", () => { const [a, b] = pf(12), [c, d] = pf(12); if (b === d || lcm(b, d) > 72 || gcd(b, d) === 1 && coin(0.4)) return [null]; const L = lcm(b, d); return [`${a}${b}${c}${d}`, P(`(${F(a, b)}, ${F(c, d)})`, `(${F(a * L / b, L)}, ${F(c * L / d, L)})`)]; }, { inst: "분모의 최소공배수로 통분하세요." }),
    S("분수의 크기 비교", () => { const [a, b] = pf(12), [c, d] = pf(12); if (b === d) return [null]; const x = a * d - c * b; return [`${a}${b}${c}${d}`, P(`${F(a, b)} ○ ${F(c, d)}`, x > 0 ? "&gt;" : x < 0 ? "&lt;" : "=")]; }, { n: 24, cols: 3, inst: "○ 안에 &gt;, =, &lt; 를 알맞게 쓰세요." }),
  ] },
  { sem: 1, name: "분모가 다른 분수의 덧셈과 뺄셈", steps: [
    S("진분수의 덧셈", () => { const [a, b] = pf(12), [c, d] = pf(12); if (b === d) return [null]; return [`${a}${b}+${c}${d}`, P(eq(`${F(a, b)} + ${F(c, d)}`), ans(qa(Q(a, b), Q(c, d))))]; }),
    S("진분수의 뺄셈", () => { const [a, b] = pf(12), [c, d] = pf(12); if (b === d || a * d <= c * b) return [null]; return [`${a}${b}-${c}${d}`, P(eq(`${F(a, b)} − ${F(c, d)}`), ans(qs(Q(a, b), Q(c, d))))]; }),
    S("대분수의 덧셈", () => { const [a, b] = pf(10), [c, d] = pf(10), x = ri(1, 5), y = ri(1, 5); if (b === d) return [null]; return [`${x}${a}${b}+${y}${c}${d}`, P(eq(`${fm(x, a, b)} + ${fm(y, c, d)}`), ans(qa(Q(x * b + a, b), Q(y * d + c, d))))]; }),
    S("대분수의 뺄셈 (받아내림 없음)", () => { const [a, b] = pf(10), [c, d] = pf(10), x = ri(2, 7), y = ri(1, x - 1); if (b === d || a * d <= c * b) return [null]; return [`${x}${a}${b}-${y}${c}${d}`, P(eq(`${fm(x, a, b)} − ${fm(y, c, d)}`), ans(qs(Q(x * b + a, b), Q(y * d + c, d))))]; }),
    S("받아내림이 있는 대분수의 뺄셈", () => { const [a, b] = pf(10), [c, d] = pf(10), x = ri(2, 7), y = ri(1, x - 1); if (b === d || a * d >= c * b) return [null]; return [`${x}${a}${b}-${y}${c}${d}`, P(eq(`${fm(x, a, b)} − ${fm(y, c, d)}`), ans(qs(Q(x * b + a, b), Q(y * d + c, d))))]; }),
  ] },
  { sem: 2, name: "분수의 곱셈", steps: [
    S("분수 × 자연수", () => { const [a, b] = pf(12), k = ri(2, 12); if (coin(0.35)) { const w = ri(1, 4); return [`m${w}${a}${b}x${k}`, P(eq(`${fm(w, a, b)} × ${k}`), ans(qm(Q(w * b + a, b), Q(k))))]; } return [`${a}${b}x${k}`, P(eq(`${F(a, b)} × ${k}`), ans(qm(Q(a, b), Q(k))))]; }),
    S("자연수 × 분수", () => { const [a, b] = pf(12), k = ri(2, 12); if (coin(0.35)) { const w = ri(1, 4); return [`m${k}x${w}${a}${b}`, P(eq(`${k} × ${fm(w, a, b)}`), ans(qm(Q(w * b + a, b), Q(k))))]; } return [`${k}x${a}${b}`, P(eq(`${k} × ${F(a, b)}`), ans(qm(Q(a, b), Q(k))))]; }),
    S("진분수 × 진분수", () => { const [a, b] = pf(12), [c, d] = pf(12); return [`${a}${b}x${c}${d}`, P(eq(`${F(a, b)} × ${F(c, d)}`), ans(qm(Q(a, b), Q(c, d))))]; }),
    S("대분수의 곱셈", () => { const [a, b] = pf(8), [c, d] = pf(8), x = ri(1, 4), y = ri(1, 3); return [`${x}${a}${b}x${y}${c}${d}`, P(eq(`${fm(x, a, b)} × ${fm(y, c, d)}`), ans(qm(Q(x * b + a, b), Q(y * d + c, d))))]; }),
    S("세 분수의 곱셈", () => { const [a, b] = pf(10), [c, d] = pf(10), [e, f] = pf(10); return [`${a}${b}${c}${d}${e}${f}`, P(eq(`${F(a, b)} × ${F(c, d)} × ${F(e, f)}`), ans(qm(qm(Q(a, b), Q(c, d)), Q(e, f))))]; }),
  ] },
  { sem: 2, name: "소수의 곱셈", steps: [
    S("소수 × 자연수", () => { const p = coin(0.6) ? 1 : 2, a = ri(2, p === 1 ? 99 : 999), k = ri(2, 12); if (a % 10 === 0) return [null]; return [`${a},${p}x${k}`, P(eq(`${ds(a, p)} × ${k}`), ds(a * k, p))]; }),
    S("자연수 × 소수", () => { const p = coin(0.6) ? 1 : 2, a = ri(2, p === 1 ? 99 : 999), k = ri(2, 30); if (a % 10 === 0) return [null]; return [`${k}x${a},${p}`, P(eq(`${k} × ${ds(a, p)}`), ds(a * k, p))]; }),
    S("소수 × 소수", () => { const pa = ri(1, 2), pb = 1, a = ri(2, pa === 1 ? 99 : 499), b = ri(2, 99); if (a % 10 === 0 || b % 10 === 0) return [null]; return [`${a},${pa}x${b}`, P(eq(`${ds(a, pa)} × ${ds(b, pb)}`), ds(a * b, pa + pb))]; }),
    S("곱의 소수점 위치", () => {
      const p = ri(1, 3), a = ri(11, 999); if (a % 10 === 0) return [null];
      const k = pick([1, 2, 3]);
      if (coin()) return [`${a},${p}x${k}`, P(eq(`${ds(a, p)} × ${10 ** k}`), ds(a * 10 ** k, p))];
      return [`${a}x0.${k}`, P(eq(`${a} × ${ds(1, k)}`), ds(a, k))];
    }, { n: 24, cols: 3 }),
  ] },
];

const E6 = [
  { sem: 1, name: "분수의 나눗셈", steps: [
    S("(자연수) ÷ (자연수)의 몫을 분수로", () => { const a = ri(1, 15), b = ri(2, 12); if (a % b === 0) return [null]; return [`${a}/${b}`, P(eq(`${a} ÷ ${b}`), ans(Q(a, b)))]; }),
    S("진분수 ÷ 자연수", () => { const [a, b] = pf(12), k = ri(2, 9); return [`${a}${b}/${k}`, P(eq(`${F(a, b)} ÷ ${k}`), ans(qd(Q(a, b), Q(k))))]; }),
    S("가분수 ÷ 자연수", () => { const b = ri(2, 9), a = ri(b + 1, 4 * b), k = ri(2, 9); if (gcd(a, b) !== 1) return [null]; return [`${a}${b}/${k}`, P(eq(`${F(a, b)} ÷ ${k}`), ans(qd(Q(a, b), Q(k))))]; }),
    S("대분수 ÷ 자연수", () => { const [a, b] = pf(9), w = ri(1, 8), k = ri(2, 12); return [`${w}${a}${b}/${k}`, P(eq(`${fm(w, a, b)} ÷ ${k}`), ans(qd(Q(w * b + a, b), Q(k))))]; }),
  ] },
  { sem: 1, name: "소수의 나눗셈", steps: [
    S("소수 ÷ 자연수 (몫이 1보다 큼)", () => { const k = ri(2, 9), q = ri(101, 999); if (q % 10 === 0) return [null]; const p = coin() ? 2 : 1, qq = p === 1 ? ri(11, 99) : q; if (qq % 10 === 0) return [null]; return [`${qq * k},${p}/${k}`, P(eq(`${ds(qq * k, p)} ÷ ${k}`), ds(qq, p))]; }),
    S("소수 ÷ 자연수 (몫이 1보다 작음)", () => { const k = ri(2, 9), q = ri(11, 99); if (q % 10 === 0 || q * k >= 100 * k) return [null]; return [`${q * k}/${k}`, P(eq(`${ds(q * k, 2)} ÷ ${k}`), ds(q, 2))]; }),
    S("소수점 아래 0을 내려 계산하기", () => { const k = pick([2, 4, 5, 6, 8]), q = ri(11, 999); if (q % 10 === 0) return [null]; const a = q * k; if (a % 10 !== 0) return [null]; return [`${a}/${k}`, P(eq(`${ds(a, 2)} ÷ ${k}`), ds(q, 2))]; }),
    S("몫의 소수 첫째 자리에 0이 있는 나눗셈", () => { const k = ri(2, 9), w = ri(1, 9), q = w * 100 + ri(1, 9); return [`${q * k}/${k}`, P(eq(`${ds(q * k, 2)} ÷ ${k}`), ds(q, 2))]; }),
    S("(자연수) ÷ (자연수)의 몫을 소수로", () => { const k = pick([2, 4, 5, 8, 20, 25]), a = ri(1, 40); if (a % k === 0) return [null]; const v = (a * 1000) / k; if (!Number.isInteger(v)) return [null]; return [`${a}/${k}`, P(eq(`${a} ÷ ${k}`), ds(v, 3))]; }),
  ] },
  { sem: 1, name: "비와 비율", steps: [
    S("비율을 분수와 소수로", () => { const b = pick([2, 4, 5, 8, 10, 20, 25, 50]), a = ri(1, b * 2); if (a === b) return [null]; return [`${a}:${b}`, P(`${a} : ${b}`, `${fq(Q(a, b))} , ${ds((a * 1000) / b, 3)}`)]; }, { inst: "비율을 기약분수와 소수로 나타내세요." }),
    S("백분율", () => {
      const f = ri(0, 2), pc = ri(1, 99);
      if (f === 0) return [`d${pc}`, P(`${ds(pc, 2)} = ${PB} %`, pc)];
      if (f === 1) { const x = Q(pc, 100); if (x.d > 50) return [null]; return [`f${pc}`, P(`${F(x.n, x.d)} = ${PB} %`, pc)]; }
      return [`p${pc}`, P(`${pc} % 를 소수로`, ds(pc, 2))];
    }, { inst: "알맞은 수를 쓰세요." }),
  ] },
  { sem: 2, name: "분수의 나눗셈", steps: [
    S("분모가 같은 분수의 나눗셈", () => { const d = ri(3, 15), a = ri(1, d - 1), b = ri(1, d - 1); if (a === b) return [null]; return [`${a}${b}/${d}`, P(eq(`${F(a, d)} ÷ ${F(b, d)}`), ans(Q(a, b)))]; }),
    S("분모가 다른 분수의 나눗셈", () => { const [a, b] = pf(12), [c, d] = pf(12); if (b === d) return [null]; return [`${a}${b}/${c}${d}`, P(eq(`${F(a, b)} ÷ ${F(c, d)}`), ans(qd(Q(a, b), Q(c, d))))]; }),
    S("(자연수) ÷ (분수)", () => { const [c, d] = pf(12), k = ri(2, 15); return [`${k}/${c}${d}`, P(eq(`${k} ÷ ${F(c, d)}`), ans(qd(Q(k), Q(c, d))))]; }),
    S("가분수의 나눗셈", () => { const b = ri(2, 9), a = ri(b + 1, 3 * b), [c, d] = pf(9); if (gcd(a, b) !== 1) return [null]; return [`${a}${b}/${c}${d}`, P(eq(`${F(a, b)} ÷ ${F(c, d)}`), ans(qd(Q(a, b), Q(c, d))))]; }),
    S("대분수의 나눗셈", () => { const [a, b] = pf(9), [c, d] = pf(9), x = ri(1, 6); if (coin(0.6)) return [`${x}${a}${b}/${c}${d}`, P(eq(`${fm(x, a, b)} ÷ ${F(c, d)}`), ans(qd(Q(x * b + a, b), Q(c, d))))]; const y = ri(1, 3); return [`${x}${a}${b}/${y}${c}${d}`, P(eq(`${fm(x, a, b)} ÷ ${fm(y, c, d)}`), ans(qd(Q(x * b + a, b), Q(y * d + c, d))))]; }),
  ] },
  { sem: 2, name: "소수의 나눗셈", steps: [
    S("자릿수가 같은 소수의 나눗셈", () => { const p = ri(1, 2), b = ri(2, p === 1 ? 99 : 999), q = ri(2, 15); if (b % 10 === 0) return [null]; return [`${b * q},${p}/${b}`, P(eq(`${ds(b * q, p)} ÷ ${ds(b, p)}`), q)]; }),
    S("자릿수가 다른 소수의 나눗셈", () => { const b = ri(11, 99), q = ri(11, 99); if (b % 10 === 0 || q % 10 === 0) return [null]; return [`${b * q}/${b}`, P(eq(`${ds(b * q, 2)} ÷ ${ds(b, 1)}`), ds(q, 1))]; }),
    S("(자연수) ÷ (소수)", () => { const p = ri(1, 2), b = ri(2, p === 1 ? 99 : 999), q = ri(2, 60); if (b % 10 === 0 || (b * q) % 10 ** p) return [null]; return [`${q}/${b},${p}`, P(eq(`${(b * q) / 10 ** p} ÷ ${ds(b, p)}`), q)]; }),
    S("몫을 반올림하여 나타내기", () => {
      const a = ri(11, 999), b = ri(3, 99), pa = ri(0, 1), pb = 1, k = ri(1, 2);
      if (a % 10 === 0 || b % 10 === 0) return [null];
      const num = a * 10 ** pb, den = b * 10 ** pa; // a/10^pa ÷ b/10^pb
      if ((num * 10 ** (k + 1)) % den === 0) return [null];
      const r = Math.floor((2 * num * 10 ** k + den) / (2 * den));
      return [`${a},${pa}/${b},${k}`, P(`${ds(a, pa)} ÷ ${ds(b, pb)} <small>(소수 ${k === 1 ? "첫째" : "둘째"} 자리까지)</small>`, ds(r, k))];
    }, { n: 16, inst: "몫을 반올림하여 주어진 자리까지 나타내세요." }),
    S("나누어 주고 남는 양 (몫과 나머지)", () => { const k = ri(2, 9), q = ri(2, 20), r = ri(1, k * 10 - 1); if (r % 10 === 0) return [null]; const a = k * q * 10 + r; return [`${a}/${k}`, P(`${ds(a, 1)} ÷ ${k} = ${PB} ··· ${PB}`, `${q} ··· ${ds(r, 1)}`)]; }, { inst: "몫을 자연수까지 구하고 나머지를 쓰세요." }),
  ] },
  { sem: 2, name: "비례식과 비례배분", steps: [
    S("비례식 풀기", () => { const a = ri(1, 12), b = ri(1, 12), k = ri(2, 9); if (a === b) return [null]; const c = a * k, d = b * k, f = ri(0, 3); const t = [[a, b, c, BX], [a, b, BX, d], [a, BX, c, d], [BX, b, c, d]][f]; return [`${a}${b}${k}${f}`, P(`${t[0]} : ${t[1]} = ${t[2]} : ${t[3]}`, [d, c, b, a][f])]; }, { inst: "□ 안에 알맞은 수를 쓰세요." }),
    S("비례배분", () => { const a = ri(1, 9), b = ri(1, 9); if (a === b || gcd(a, b) > 1) return [null]; const n = (a + b) * ri(2, 20); return [`${n}${a}${b}`, P(`${n}${josa(n, "을", "를")} ${a} : ${b}로 비례배분`, `${(n * a) / (a + b)}, ${(n * b) / (a + b)}`)]; }, { inst: "비례배분하세요." }),
  ] },
];

// ---------- 중학교 ----------
const rq = (fr = 0.3, M = 12) => (coin(fr) ? (() => { const [a, b] = pf(9); return Q(sgn() * a, b); })() : Q(sgn() * ri(2, M)));
const sn = (x, first) => (first || x.n >= 0 ? fq(x) : `(${fq(x)})`);
const xs = (s) => (s === 1 ? "" : s === -1 ? MI : N(s));
const xEq = (s) => `x = ${fq(typeof s === "number" ? Q(s) : s)}`;
const powH = (base, n) => `${base}<sup>${n}</sup>`;
const primeF = (n) => { const o = []; for (let p = 2; p <= n; p++) { let e = 0; while (n % p === 0) { n /= p; e++; } if (e) o.push(e > 1 ? powH(p, e) : String(p)); } return o.join(" × "); };
const isPrime = (n) => { if (n < 2) return false; for (let k = 2; k * k <= n; k++) if (n % k === 0) return false; return true; };
// 일차식 ax+b (Q 계수)
const L = (a, b, v = "x") => lin([[a, v], [b, ""]]);
const evalP = (p, val) => { let s = Q(0); for (const [k, c] of p) { let t = c; const e = unkey(k); for (const v in e) t = qm(t, Q(val[v] ** e[v])); s = qa(s, t); } return s; };
const vars2 = () => pick([["x", "y"], ["a", "b"]]);
const ineqAns = (op, s) => `x ${op} ${fq(s)}`;
const flip = { "<": "&gt;", "&gt;": "<", "≤": "≥", "≥": "≤" };
const ineqOps = ["<", "&gt;", "≤", "≥"];

const M1 = [
  { name: "소인수분해", steps: [
    S("소인수분해하기", () => { const ps = [2, 2, 2, 3, 3, 5, 7, 11, 13]; let n = 1, k = ri(2, 5); for (let i = 0; i < k; i++) n *= pick(ps); if (n < 12 || n > 600 || isPrime(n)) return [null]; return [`${n}`, P(`${n}`, primeF(n))]; }, { inst: "소인수분해하세요." }),
    S("최대공약수", () => { const g = ri(2, 30), a = ri(2, 12), b = ri(2, 12); if (a === b || gcd(a, b) !== 1 || g * Math.max(a, b) > 300) return [null]; return [`${g * a},${g * b}`, P(`(${g * a}, ${g * b})`, g)]; }, { inst: "두 수의 최대공약수를 구하세요." }),
    S("최소공배수", () => { const a = ri(6, 90), b = ri(6, 90); if (a === b || lcm(a, b) > 1000 || gcd(a, b) === 1) return [null]; return [`${Math.min(a, b)},${Math.max(a, b)}`, P(`(${a}, ${b})`, lcm(a, b))]; }, { inst: "두 수의 최소공배수를 구하세요." }),
  ] },
  { name: "정수와 유리수", steps: [
    S("정수와 유리수의 덧셈", () => { const x = rq(), y = rq(); return [`${fq(x)}+${fq(y)}`, P(eq(`${sgq(x)} + ${sgq(y)}`), fq(qa(x, y)))]; }),
    S("정수와 유리수의 뺄셈", () => { const x = rq(), y = rq(); return [`${fq(x)}-${fq(y)}`, P(eq(`${sgq(x)} − ${sgq(y)}`), fq(qs(x, y)))]; }),
    S("덧셈과 뺄셈이 섞인 계산", () => { const k = ri(3, 4), xs_ = Array.from({ length: k }, () => rq(0.2)), ops = xs_.slice(1).map(() => pick(["+", "−"])); let v = xs_[0]; ops.forEach((o, i) => (v = o === "+" ? qa(v, xs_[i + 1]) : qs(v, xs_[i + 1]))); return [xs_.map(fq).join(ops.join("")), P(eq(xs_.map((x, i) => (i ? ` ${ops[i - 1]} ` : "") + sgq(x)).join("")), fq(v))]; }),
    S("정수와 유리수의 곱셈", () => { const k = ri(2, 3), xs_ = Array.from({ length: k }, () => (coin(0.3) ? rq(1) : Q(sgn() * ri(2, 9)))); const v = xs_.reduce(qm); if (Math.abs(v.n) > 400) return [null]; return [xs_.map(fq).join("x"), P(eq(xs_.map(sgq).join(" × ")), fq(v))]; }),
    S("거듭제곱의 계산", () => {
      const f = ri(0, 3), a = ri(1, 5), n = ri(2, a <= 2 ? 5 : 3);
      if (f === 0) return [`p${a}${n}`, P(eq(powH(`(${MI}${a})`, n)), N((-a) ** n))];
      if (f === 1) return [`m${a}${n}`, P(eq(MI + powH(a, n)), N(-(a ** n)))];
      if (f === 2) { const [p, q] = pf(5); const s = sgn(), m = ri(2, 3); return [`f${s}${p}${q}${m}`, P(eq(powH(`(${s < 0 ? MI : ""}${F(p, q)})`, m)), fq(Q((s * p) ** m, q ** m)))]; }
      const b = ri(1, 4), m = ri(2, 3); return [`x${a}${n}${b}${m}`, P(eq(`${powH(`(${MI}${a})`, n)} × ${powH(b === 1 ? `(${MI}1)` : b, m)}`), N((-a) ** n * (b === 1 ? (-1) ** m : b ** m)))];
    }),
    S("정수와 유리수의 나눗셈", () => { const x = rq(0.4, 30), y = rq(0.4, 9); const v = qd(x, y); if (Math.abs(v.n) > 200 || v.d > 30) return [null]; return [`${fq(x)}/${fq(y)}`, P(eq(`${sgq(x)} ÷ ${sgq(y)}`), fq(v))]; }),
    S("곱셈과 나눗셈의 혼합 계산", () => { const x = rq(0.3), y = rq(0.3, 9), z = rq(0.3, 9), o1 = pick(["×", "÷"]), o2 = pick(["×", "÷"]); const f = (u, o, w) => (o === "×" ? qm(u, w) : qd(u, w)); const v = f(f(x, o1, y), o2, z); if (Math.abs(v.n) > 200 || v.d > 30) return [null]; return [`${fq(x)}${o1}${fq(y)}${o2}${fq(z)}`, P(eq(`${sn(x, 1)} ${o1} ${sn(y)} ${o2} ${sn(z)}`), fq(v))]; }),
    S("괄호와 거듭제곱이 있는 혼합 계산", () => {
      const f = ri(0, 2), a = nz(-5, 5), b = ri(2, 6), c = nz(-12, 12), d = nz(-4, 4);
      if (f === 0) { if (c % d) return [null]; const v = a * a * b - c / d; return [`0${a}${b}${c}${d}`, P(eq(`${powH(a < 0 ? `(${N(a)})` : a, 2)} × ${b} − ${c < 0 ? `(${N(c)})` : c} ÷ ${d < 0 ? `(${N(d)})` : d}`), N(v))]; }
      if (f === 1) { const e = ri(2, 9), g = ri(2, 4); const v = e - (a ** 2 - d) * g; return [`1${a}${d}${e}${g}`, P(eq(`${e} − {${powH(a < 0 ? `(${N(a)})` : a, 2)} ${d < 0 ? "+" : "−"} ${Math.abs(d)}} × ${g}`), N(v))]; }
      const [p, q] = pf(4); const v = qa(qm(Q(-(p ** 2), q ** 2), Q(b * q * q)), Q(c)); return [`2${p}${q}${b}${c}`, P(eq(`${MI}${powH(`(${F(p, q)})`, 2)} × ${b * q * q} + ${c < 0 ? `(${N(c)})` : c}`), fq(v))];
    }, { n: 16 }),
  ] },
  { name: "문자와 식", steps: [
    S("식의 값", () => { const [x, y] = ["x", "y"], two = coin(0.4), vx = nz(-4, 4), vy = nz(-4, 4); const p = two ? poly([nz(-4, 4), { x: 1 }], [nz(-4, 4), { y: 1 }], [ri(-5, 5), {}]) : poly([nz(-3, 3), { x: 2 }], [ri(-5, 5), { x: 1 }], [ri(-6, 6), {}]); if (p.size < 2) return [null]; const v = evalP(p, { x: vx, y: vy }); return [`${ph(p)}${vx}${two ? vy : ""}`, P(`${two ? `x = ${N(vx)}, y = ${N(vy)}` : `x = ${N(vx)}`} 일 때, ${ph(p)} 의 값`, fq(v))]; }, { n: 16 }),
    S("일차식과 수의 곱셈", () => { const a = nz(-9, 9), b = nz(-9, 9), k = nz(-6, 6); if (Math.abs(k) === 1) return [null]; const r = L(a * k, b * k); return coin() ? [`${k}(${a},${b})`, P(eq(`${N(k)}(${L(a, b)})`), r)] : [`(${a},${b})${k}`, P(eq(`(${L(a, b)}) × ${k < 0 ? `(${N(k)})` : k}`), r)]; }),
    S("일차식과 수의 나눗셈", () => { const k = nz(-6, 6), a = nz(-6, 6) * k, b = nz(-6, 6) * k; if (Math.abs(k) === 1) return [null]; if (coin(0.3)) { const [p, q] = pf(5); const s = sgn(); const A = a * p, B = b * p; const div = Q(s * p, q); return [`f(${A},${B})${s}${p}${q}`, P(eq(`(${L(A, B)}) ÷ (${s < 0 ? MI : ""}${F(p, q)})`), L(qd(Q(A), div), qd(Q(B), div)))]; } return [`(${a},${b})/${k}`, P(eq(`(${L(a, b)}) ÷ ${k < 0 ? `(${N(k)})` : k}`), L(a / k, b / k))]; }),
    S("동류항 정리하기", () => { const a = nz(-9, 9), b = ri(-9, 9), c = nz(-9, 9), d = nz(-9, 9); if (a + c === 0 && b + d === 0) return [null]; const t = [[a, "x"], [b, ""], [c, "x"], [d, ""]]; if (coin()) [t[1], t[2]] = [t[2], t[1]]; return [`${a},${b},${c},${d}`, P(eq(lin(t)), L(a + c, b + d))]; }),
    S("괄호가 있는 일차식의 계산", () => { const k1 = nz(-5, 5), k2 = nz(2, 5), a1 = nz(-6, 6), b1 = nz(-9, 9), a2 = nz(-6, 6), b2 = nz(-9, 9), op = pick(["+", "−"]); const s = op === "+" ? 1 : -1; return [`${k1}${a1}${b1}${op}${k2}${a2}${b2}`, P(eq(`${k1 === 1 ? "" : k1 === -1 ? MI : N(k1)}(${L(a1, b1)}) ${op} ${k2}(${L(a2, b2)})`), L(k1 * a1 + s * k2 * a2, k1 * b1 + s * k2 * b2))]; }),
    S("분수 꼴 일차식의 계산", () => { const d1 = ri(2, 6), d2 = ri(2, 6), a1 = nz(-5, 5), b1 = nz(-7, 7), a2 = nz(-5, 5), b2 = nz(-7, 7), op = pick(["+", "−"]); if (d1 === d2) return [null]; const s = op === "+" ? 1 : -1; const A = qa(Q(a1, d1), Q(s * a2, d2)), B = qa(Q(b1, d1), Q(s * b2, d2)); return [`${d1}${a1}${b1}${op}${d2}${a2}${b2}`, P(eq(`${F(L(a1, b1), d1)} ${op} ${F(L(a2, b2), d2)}`), L(A, B))]; }, { n: 16 }),
  ] },
  { name: "일차방정식", steps: [
    S("이항하여 풀기", () => { const s = nz(-9, 9), a = nz(-9, 9), c = coin(0.3) ? 0 : nz(-9, 9), b = ri(-12, 12); if (a === c) return [null]; const d = (a - c) * s + b; return [`${a}${b}${c}${d}`, P(`${L(a, b)} = ${L(c, d)}`, xEq(s))]; }, { inst: "일차방정식을 푸세요." }),
    S("괄호가 있는 일차방정식", () => { const s = nz(-8, 8), k1 = nz(-5, 5), k2 = nz(-5, 5), p = nz(-6, 6), q = nz(-6, 6); if (k1 === k2) return [null]; const r = k1 * (s + p) - k2 * (s + q); if (Math.abs(r) > 30) return [null]; const kH = (k) => (k === 1 ? "" : k === -1 ? MI : N(k)); return [`${k1}${p}${k2}${q}${r}`, P(`${kH(k1)}(${L(1, p)}) = ${kH(k2)}(${L(1, q)})${r ? (r < 0 ? ` ${MI} ${-r}` : ` + ${r}`) : ""}`, xEq(s))]; }, { inst: "일차방정식을 푸세요." }),
    S("계수가 소수인 일차방정식", () => { const s = nz(-8, 8), A = nz(-15, 15), C = nz(-15, 15), B = ri(-30, 30); if (A === C) return [null]; const D = (A - C) * s + B; if ([A, B, C, D].filter((v) => v % 10).length < 3 || Math.abs(D) > 99) return [null]; return [`${A}${B}${C}${D}`, P(`${dlin([[A, "x"], [B, ""]])} = ${dlin([[C, "x"], [D, ""]])}`, xEq(s))]; }, { inst: "일차방정식을 푸세요." }),
    S("계수가 분수인 일차방정식", () => { const s = nz(-6, 6) * pick([1, 2, 3, 6]), a = Q(nz(-3, 3), ri(2, 4)), c = Q(nz(-3, 3), ri(2, 6)), b = Q(ri(-5, 5), ri(1, 3)); if (qeq(a, c) || Math.abs(s) > 18) return [null]; const d = qa(qm(qs(a, c), Q(s)), b); if (d.d > 12) return [null]; return [`${fq(a)}${fq(b)}${fq(c)}${s}`, P(`${L(a, b)} = ${L(c, d)}`, xEq(s))]; }, { n: 16, inst: "일차방정식을 푸세요." }),
  ] },
];

const M2 = [
  { name: "유리수와 순환소수", steps: [
    S("순환소수를 분수로", () => {
      const I = ri(0, 3), al = coin(0.4) ? 1 : 0, rl = coin(0.6) ? 1 : 2;
      const a = al ? String(ri(0, 9)) : "", r = rl === 1 ? String(ri(1, 8)) : String(ri(10, 98));
      if (rl === 2 && r[0] === r[1]) return [null];
      if (al && a === r.at(-1)) return [null];
      if (!I && !a && r === "0") return [null];
      const A = Number(I + a + r), B = Number(I + a), den = Number("9".repeat(rl) + "0".repeat(al));
      const x = Q(A - B, den), dot = (ch) => `<span class="dot">${ch}</span>`;
      const rH = rl === 1 ? dot(r) : dot(r[0]) + dot(r[1]);
      return [`${I}.${a}(${r})`, P(eq(`${I}.${a}${rH}`), fq(x))];
    }, { n: 24, cols: 3, inst: "기약분수로 나타내세요." }),
    S("유한소수로 나타낼 수 있는 분수", () => { let d = ri(6, 120), n = ri(1, d - 1); if (coin(0.45)) { const d0 = pick([2, 4, 5, 8, 10, 16, 20, 25, 40, 50]), k = pick([3, 6, 7, 9, 11, 12, 13]), m = ri(1, d0 - 1); if (gcd(m, d0) !== 1 || d0 * k > 200) return [null]; d = d0 * k; n = m * k; } const x = Q(n, d); let t = x.d; while (t % 2 === 0) t /= 2; while (t % 5 === 0) t /= 5; return [`${n}/${d}`, P(F(n, d), t === 1 ? "○" : "×")]; }, { n: 24, cols: 3, inst: "유한소수로 나타낼 수 있으면 ○, 없으면 × 하세요." }),
  ] },
  { name: "식의 계산", steps: [
    S("지수법칙", () => {
      const v = pick(["a", "x"]), w = v === "a" ? "b" : "y", m = ri(2, 6), n = ri(2, 5), f = ri(0, 4);
      if (f === 0) return [`0${v}${m}${n}`, P(eq(`${powH(v, m)} × ${powH(v, n)}`), powH(v, m + n))];
      if (f === 1) return [`1${v}${m}${n}`, P(eq(powH(`(${powH(v, m)})`, n)), powH(v, m * n))];
      if (f === 2) { if (m === n) return [`2${v}${m}`, P(eq(`${powH(v, m)} ÷ ${powH(v, n)}`), "1")]; return [`2${v}${m}${n}`, P(eq(`${powH(v, m)} ÷ ${powH(v, n)}`), m > n ? SUPV(v, m - n) : F(1, SUPV(v, n - m)))]; }
      if (f === 3) { const k = ri(2, 3); return [`3${v}${m}${n}${k}`, P(eq(powH(`(${v}${SUPV(w, m)})`, k)), `${SUPV(v, k)}${SUPV(w, m * k)}`)]; }
      const k = ri(2, 3); return [`4${v}${m}${k}`, P(eq(powH(`(${F(SUPV(v, m), w)})`, k)), F(SUPV(v, m * k), SUPV(w, k)))];
    }, { n: 24, cols: 3 }),
    S("단항식의 곱셈", () => { const A = poly([nz(-6, 6), { x: ri(0, 3), y: ri(0, 2) }]), B = poly([nz(-6, 6), { x: ri(0, 3), y: ri(0, 2) }]); if (coin(0.3)) { const k = 2, C = ppow(A, k); if (ph(A).length > 30) return [null]; const r = pmul(C, B); return [`${ph(A)}^2${ph(B)}`, P(eq(`${powH(`(${ph(A)})`, 2)} × ${monoP(B)}`), ph(r))]; } return [`${ph(A)}*${ph(B)}`, P(eq(`${monoP(A, 1)} × ${monoP(B)}`), ph(pmul(A, B)))]; }),
    S("단항식의 나눗셈", () => { const B = poly([nz(-5, 5), { x: ri(0, 2), y: ri(0, 2) }]), C = poly([nz(-5, 5), { x: ri(0, 2), y: ri(0, 2) }]); if (![...B.keys()][0] && ![...C.keys()][0]) return [null]; if (coin(0.3)) { const [p, q] = pf(4); const Bf = pscale(B, Q(1, 1)); const bk = [...B.keys()][0], bc = B.get(bk); const Bq = new Map([[bk, qm(bc, Q(p, q))]]); const Cq = pscale(C, q); const A = pmul(Bq, Cq); return [`${ph(A)}/${ph(Bq)}`, P(eq(`${monoP(A, 1)} ÷ ${monoP(Bq)}`), ph(Cq))]; } const A = pmul(B, C); return [`${ph(A)}/${ph(B)}`, P(eq(`${monoP(A, 1)} ÷ ${monoP(B)}`), ph(C))]; }),
    S("단항식의 곱셈과 나눗셈", () => { const A = poly([nz(-8, 8), { x: ri(1, 3), y: ri(0, 3) }]), B = poly([nz(-6, 6), { x: ri(0, 2), y: ri(0, 2) }]), C = poly([nz(-6, 6), { x: ri(0, 2), y: ri(0, 2) }]); const AB = pmul(A, B), ck = [...C.keys()][0], ak = [...AB.keys()][0]; const ea = unkey(ak), ec = unkey(ck); for (const v of ["x", "y"]) if ((ea[v] || 0) < (ec[v] || 0)) return [null]; const q = qd(AB.get(ak), C.get(ck)); if (!qi(q)) return [null]; const e = {}; for (const v of ["x", "y"]) if ((ea[v] || 0) - (ec[v] || 0)) e[v] = (ea[v] || 0) - (ec[v] || 0); const D = poly([q, e]); return [`${ph(A)}${ph(B)}${ph(C)}`, P(eq(`${monoP(A, 1)} × ${monoP(B)} ÷ ${monoP(C)}`), ph(D))]; }, { n: 16 }),
    S("다항식의 덧셈과 뺄셈", () => { const [x, y] = vars2(); const mk = () => (coin(0.35) ? poly([nz(-5, 5), { [x]: 2 }], [nz(-7, 7), { [x]: 1 }], [ri(-9, 9), {}]) : poly([nz(-7, 7), { [x]: 1 }], [nz(-7, 7), { [y]: 1 }], [ri(-9, 9), {}])); const A = mk(), B = mk(), op = pick(["+", "−"]), k = coin(0.4) ? ri(2, 3) : 1; const r = op === "+" ? padd(A, pscale(B, k)) : psub(A, pscale(B, k)); return [`${ph(A)}${op}${k}${ph(B)}`, P(eq(`(${ph(A)}) ${op} ${k > 1 ? k : ""}(${ph(B)})`), ph(r))]; }, { n: 16 }),
    S("다항식과 단항식의 곱셈", () => { const m = poly([nz(-5, 5), { x: ri(0, 2), y: ri(0, 1) }]); if (![...m.keys()][0]) return [null]; const A = poly([nz(-5, 5), { x: 1 }], [nz(-5, 5), { y: 1 }], [ri(-5, 5), {}]); const r = pmul(m, A); return coin() ? [`${ph(m)}(${ph(A)})`, P(eq(`${monoP(m, 1, 1)}(${ph(A)})`), ph(r))] : [`(${ph(A)})${ph(m)}`, P(eq(`(${ph(A)}) × ${monoP(m)}`), ph(r))]; }),
    S("다항식과 단항식의 나눗셈", () => { const m = poly([nz(-4, 4), { x: ri(1, 2), y: ri(0, 1) }]); const A = poly([nz(-5, 5), { x: ri(1, 2), y: ri(0, 1) }], [nz(-5, 5), { y: ri(1, 2) }], [ri(-5, 5), { x: 1 }]); if (A.size < 2) return [null]; const T = pmul(A, m); if (coin(0.3)) { const [p, q] = pf(4); const mk = [...m.keys()][0]; const mq = new Map([[mk, qm(m.get(mk), Q(p, q))]]); const Tq = pmul(pscale(A, Q(p, q)), m); const R_ = pscale(A, Q(1)); return [`${ph(Tq)}/${ph(mq)}`, P(eq(`(${ph(Tq)}) ÷ ${monoP(mq)}`), ph(R_))]; } return [`${ph(T)}/${ph(m)}`, P(eq(`(${ph(T)}) ÷ ${monoP(m)}`), ph(A))]; }, { n: 16 }),
    S("식의 값", () => { const vx = nz(-3, 3), vy = nz(-3, 3); const A = poly([nz(-4, 4), { x: 2 }], [nz(-5, 5), { x: 1, y: 1 }], [ri(-5, 5), { y: 1 }]); if (A.size < 2) return [null]; return [`${ph(A)}${vx}${vy}`, P(`x = ${N(vx)}, y = ${N(vy)} 일 때, ${ph(A)} 의 값`, fq(evalP(A, { x: vx, y: vy })))]; }, { n: 16 }),
  ] },
  { name: "일차부등식", steps: [
    S("일차부등식 풀기", () => { const s = nz(-8, 8), a = nz(-7, 7), c = coin(0.4) ? 0 : nz(-7, 7), b = ri(-12, 12), op = pick(ineqOps); if (a === c) return [null]; const d = (a - c) * s + b; return [`${a}${b}${c}${d}${op}`, P(`${L(a, b)} ${op} ${L(c, d)}`, ineqAns(a - c > 0 ? op : flip[op], Q(s)))]; }, { inst: "일차부등식을 푸세요." }),
    S("괄호가 있는 일차부등식", () => { const s = nz(-7, 7), k1 = nz(-4, 4), k2 = nz(-4, 4), p = nz(-6, 6), q = nz(-6, 6), op = pick(ineqOps); if (k1 === k2) return [null]; const r = k1 * (s + p) - k2 * (s + q); const kH = (k) => (k === 1 ? "" : k === -1 ? MI : N(k)); return [`${k1}${p}${k2}${q}${op}`, P(`${kH(k1)}(${L(1, p)}) ${op} ${kH(k2)}(${L(1, q)})${r ? (r < 0 ? ` ${MI} ${-r}` : ` + ${r}`) : ""}`, ineqAns(k1 - k2 > 0 ? op : flip[op], Q(s)))]; }, { inst: "일차부등식을 푸세요." }),
    S("계수가 소수·분수인 일차부등식", () => { const s = nz(-6, 6) * pick([1, 2, 6]), a = Q(nz(-3, 3), ri(2, 4)), c = Q(nz(-3, 3), ri(2, 6)), b = Q(ri(-5, 5), ri(1, 3)), op = pick(ineqOps); if (qeq(a, c) || Math.abs(s) > 18) return [null]; const d = qa(qm(qs(a, c), Q(s)), b); if (d.d > 12) return [null]; return [`${fq(a)}${fq(b)}${fq(c)}${s}${op}`, P(`${L(a, b)} ${op} ${L(c, d)}`, ineqAns(qs(a, c).n > 0 ? op : flip[op], Q(s)))]; }, { n: 16, inst: "일차부등식을 푸세요." }),
  ] },
  { name: "연립일차방정식", steps: [
    S("가감법으로 풀기", () => sysGen((x, y) => { const a = nz(-6, 6), b = nz(-6, 6); return [[a, b, a * x + b * y], L2(a, b, a * x + b * y), 1]; }), { n: 12, inst: "연립방정식을 푸세요." }),
    S("대입법으로 풀기", () => sysGen((x, y, i) => { if (i === 0) { const m = nz(-4, 4), k = y - m * x; return [[-m, 1, k], coin() ? `y = ${L(m, k)}` : `${L(m, k)} = y`]; } const a = nz(-6, 6), b = nz(-6, 6); return [[a, b, a * x + b * y], L2(a, b, a * x + b * y), 1]; }), { n: 12, inst: "연립방정식을 푸세요." }),
    S("괄호가 있는 연립방정식", () => sysGen((x, y, i) => { const k = nz(-4, 4), al = nz(-3, 3), be = nz(-3, 3), ga = nz(-4, 4), gv = i ? "y" : "x"; const A = k * al + (gv === "x" ? ga : 0), B = k * be + (gv === "y" ? ga : 0); if (!A || !B || Math.abs(k) === 1) return null; const c = A * x + B * y; return [[A, B, c], `${N(k)}(${lin([[al, "x"], [be, "y"]])}) ${ga < 0 ? MI : "+"} ${Math.abs(ga) === 1 ? "" : Math.abs(ga)}${gv} = ${N(c)}`]; }), { n: 12, inst: "연립방정식을 푸세요." }),
    S("계수가 소수·분수인 연립방정식", () => sysGen((x, y, i) => { if (i === 0) { const A = nz(-9, 9), B = nz(-9, 9); const c = A * x + B * y; if (A % 10 === 0) return null; return [[A, B, c], `${dlin([[A, "x"], [B, "y"]])} = ${ds(c, 1)}`]; } const p = ri(2, 4), q = ri(2, 5), a = nz(-3, 3), b = nz(-3, 3); if (p === q) return null; const C = qa(Q(a * x, p), Q(b * y, q)); return [[a * q, b * p, C.n * (p * q / C.d)], `${lin([[Q(a, p), "x"], [Q(b, q), "y"]])} = ${fq(C)}`]; }), { n: 12, inst: "연립방정식을 푸세요." }),
    S("A = B = C 꼴의 방정식", () => { const x = nz(-5, 5), y = nz(-5, 5), a = nz(-5, 5), b = nz(-5, 5), c = nz(-5, 5), d = nz(-5, 5); const f = a * x + b * y, e = f - c * x - d * y; if (a * d - b * c === 0 || !e) return [null]; return [`${a}${b}${c}${d}${e}${f}`, P(`${lin([[a, "x"], [b, "y"]])} = ${lin([[c, "x"], [d, "y"], [e, ""]])} = ${N(f)}`, `x = ${N(x)}, y = ${N(y)}`)]; }, { n: 12, inst: "방정식을 푸세요." }),
  ] },
  { name: "일차함수", steps: [
    S("함숫값 구하기", () => { const a = nz(-6, 6), b = ri(-9, 9), k = nz(-5, 5); return [`${a}${b}${k}`, P(`f(x) = ${L(a, b)} 일 때, f(${N(k)})`, N(a * k + b))]; }, { inst: "함숫값을 구하세요." }),
    S("기울기와 y절편", () => { const a = coin(0.3) ? (() => { const [p, q] = pf(4); return Q(sgn() * p, q); })() : Q(nz(-6, 6)), b = Q(nz(-9, 9)); return [`${fq(a)}${fq(b)}`, P(`y = ${L(a, b)}`, `기울기 ${fq(a)}, y절편 ${fq(b)}`)]; }, { inst: "기울기와 y절편을 구하세요." }),
    S("두 점을 지나는 직선의 기울기", () => { const x1 = ri(-6, 6), x2 = ri(-6, 6), y1 = ri(-8, 8), y2 = ri(-8, 8); if (x1 === x2) return [null]; return [`${x1}${y1}${x2}${y2}`, P(`(${N(x1)}, ${N(y1)}), (${N(x2)}, ${N(y2)})`, fq(Q(y2 - y1, x2 - x1)))]; }, { inst: "두 점을 지나는 직선의 기울기를 구하세요." }),
  ] },
];
const SUPV = (v, n) => v + SUP(n);
// 단항식 표기 (앞에 올 때는 괄호 없이, 뒤에 올 때 음수면 괄호)
function monoP(m, first, noOne) { const h = ph(m); if (noOne && h === "1") return ""; if (noOne && h === MI + "1") return MI; return first || !h.startsWith(MI) ? h : `(${h})`; }
// 소수 계수 (정수/10) 일차식
function dlin(terms) { let o = "", first = true; for (const [c, v] of terms) { if (!c) continue; const a = ds(Math.abs(c), 1), body = v && a === "1" ? v : a + v; o += first ? (c < 0 ? MI : "") + body : (c < 0 ? ` ${MI} ` : " + ") + body; first = false; } return o || "0"; }
const L2 = (a, b, c) => `${lin([[a, "x"], [b, "y"]])} = ${N(c)}`;
// 연립방정식: 해 (x, y) 를 먼저 정하고 두 식을 만듦. 같은 식·비례 식·약분되는 식은 버림
function sysGen(mk) {
  const x = nz(-6, 6), y = ri(-6, 6);
  const e1 = mk(x, y, 0), e2 = mk(x, y, 1);
  if (!e1 || !e2) return [null];
  const [[a, b, c], h1, p1] = e1, [[d, e, f], h2, p2] = e2;
  if (a * e - b * d === 0) return [null];
  if ((p1 && gcd(gcd(a, b), c) > 1) || (p2 && gcd(gcd(d, e), f) > 1)) return [null];
  return [`${h1}|${h2}`, P(SYS(h1, h2), `x = ${N(x)}, y = ${N(y)}`)];
}

// 근 표기
const rootsAns = (r1, r2) => (qeq(r1, r2) ? `x = ${fq(r1)} (중근)` : `x = ${fq(r1.n * r2.d <= r2.n * r1.d ? r1 : r2)} 또는 x = ${fq(r1.n * r2.d <= r2.n * r1.d ? r2 : r1)}`);
// x = (p ± k√r) / q 꼴로 정리 (p,k,q 정수)
function pmRoot(p, k, r, q) {
  if (q < 0) { p = -p; q = -q; }
  const [c, s] = sqf(r); k *= c; r = s;
  if (r === 1) return rootsAns(Q(p + k, q), Q(p - k, q));
  const g = gcd(gcd(p, k), q); p /= g; k /= g; q /= g;
  const top = `${p ? N(p) + " ± " : "±"}${k === 1 ? "" : k}${RT(r)}`;
  return `x = ${q === 1 ? top : F(top, q)}`;
}
const quadH = (a, b, c) => ph(poly([a, { x: 2 }], [b, { x: 1 }], [c, {}]));
const fac = (p, q, v = "x") => `(${lin([[p, v], [q, ""]])})`; // (px+q)
const facS = (fs) => fs.sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([p, q]) => fac(p, q)).join("");

const M3 = [
  { name: "제곱근과 실수", steps: [
    S("제곱근 구하기", () => {
      const f = ri(0, 4), k = ri(2, 15);
      if (f === 0) { if (coin(0.3)) { const [p, q] = pf(9); return [`0f${p}${q}`, P(`${F(p * p, q * q)}의 제곱근`, `±${F(p, q)}`)]; } return [`0${k}`, P(`${k * k}의 제곱근`, `±${k}`)]; }
      if (f === 1) return [`1${k}`, P(eq(RT(k * k)), k)];
      if (f === 2) { const a = ri(2, 30); return [`2${a}`, P(eq(powH(`(${MI}${RT(a)})`, 2)), a)]; }
      if (f === 3) { const a = ri(2, 12); return [`3${a}`, P(eq(RT(powH(`(${MI}${a})`, 2))), a)]; }
      return [`4${k}`, P(eq(MI + RT(k * k)), N(-k))];
    }, { n: 24, cols: 3 }),
    S("근호 밖으로 빼기, 안으로 넣기", () => {
      const c = ri(2, 9), r = pick([2, 3, 5, 6, 7, 10, 11]);
      return coin() ? [`o${c}${r}`, P(`${RT(c * c * r)} 를 a${RT("b")} 꼴로`, `${c}${RT(r)}`)] : [`i${c}${r}`, P(`${c}${RT(r)} 를 ${RT("a")} 꼴로`, RT(c * c * r))];
    }, { n: 20, inst: "알맞은 꼴로 나타내세요." }),
    S("근호가 있는 식의 곱셈과 나눗셈", () => {
      const p = ri(2, 15), q = ri(2, 15), a = ri(1, 5), b = ri(1, 5), sqr = (v) => Number.isInteger(Math.sqrt(v));
      if (sqr(p) || sqr(q)) return [null];
      if (coin()) { const r = smul(sur([a, p]), sur([b, q])); return [`m${a}${p}${b}${q}`, P(eq(`${a > 1 ? a : ""}${RT(p)} × ${b > 1 ? b : ""}${RT(q)}`), sh(r))]; }
      const t = ri(2, 6), P2 = q * t; if (sqr(P2)) return [null]; // a√(qt) ÷ b√q = (a/b)√t
      const r2 = sur([Q(a, b), t]);
      return [`d${a}${P2}${b}${q}`, P(eq(`${a > 1 ? a : ""}${RT(P2)} ÷ ${b > 1 ? b : ""}${RT(q)}`), sh(r2))];
    }),
    S("분모의 유리화", () => {
      const b = pick([2, 3, 5, 6, 7, 8, 10, 12, 18]), a = ri(1, 12), f = ri(0, 2);
      if (f === 0) return [`0${a}${b}`, P(eq(F(a, RT(b))), sh(sur([Q(a, b), b])))];
      if (f === 1) { const t = pick([2, 3, 5, 7]); if (t === b) return [null]; return [`1${t}${b}`, P(eq(F(RT(t), RT(b))), sh(sur([Q(1, b), t * b])))]; }
      const c = ri(2, 5); return [`2${a}${c}${b}`, P(eq(F(a, `${c}${RT(b)}`)), sh(sur([Q(a, c * b), b])))];
    }),
    S("근호가 있는 식의 덧셈과 뺄셈", () => {
      const r = pick([2, 3, 5, 6, 7]), k = ri(2, 4), terms = Array.from({ length: k }, () => [nz(-5, 5), pick([1, 1, 4, 9, 16])]);
      let s = new Map(); const H = terms.map(([c, m], i) => { s = sadd(s, sur([c, m * r])); const inner = m === 1 ? `${Math.abs(c) === 1 ? "" : Math.abs(c)}${RT(r)}` : `${Math.abs(c) === 1 ? "" : Math.abs(c)}${RT(m * r)}`; return (i ? (c < 0 ? ` ${MI} ` : " + ") : c < 0 ? MI : "") + inner; });
      return [H.join(""), P(eq(H.join("")), sh(s))];
    }),
    S("근호가 있는 식의 혼합 계산", () => {
      const f = ri(0, 2);
      if (f === 0) { const p = pick([2, 3, 5, 6]), q = pick([2, 3, 5, 6, 7, 8, 10, 12]), t = pick([2, 3, 5, 6, 7, 8, 10, 12]), op = pick(["+", "−"]); if (q === t) return [null]; const r = smul(sur([1, p]), sur([1, q], [op === "+" ? 1 : -1, t])); return [`0${p}${q}${op}${t}`, P(eq(`${RT(p)}(${RT(q)} ${op} ${RT(t)})`), sh(r))]; }
      if (f === 1) { const a = pick([2, 3, 5, 6, 7]), b = nz(-5, 5); const r = smul(sur([1, a], [b, 1]), sur([1, a], [b, 1])); return [`1${a}${b}`, P(eq(powH(`(${RT(a)} ${b < 0 ? MI : "+"} ${Math.abs(b)})`, 2)), sh(r))]; }
      const a = pick([2, 3, 5, 6, 7]), b = ri(1, 6); const r = smul(sur([1, a], [b, 1]), sur([1, a], [-b, 1])); return [`2${a}${b}`, P(eq(`(${RT(a)} + ${b})(${RT(a)} ${MI} ${b})`), sh(r))];
    }, { n: 16 }),
  ] },
  { name: "다항식의 곱셈", steps: [
    S("다항식의 전개", () => { const A = poly([nz(-4, 4), { x: 1 }], [nz(-6, 6), {}]), B = poly([nz(-4, 4), { y: 1 }], [nz(-6, 6), coin() ? {} : { x: 1 }]); return [`${ph(A)}|${ph(B)}`, P(eq(`(${ph(A)})(${ph(B)})`), ph(pmul(A, B)))]; }),
    S("(a + b)², (a − b)²", () => { const p = ri(1, 5), q = nz(-7, 7), v = coin(0.4) ? "y" : ""; const A = poly([p, { x: 1 }], [q, v ? { y: 1 } : {}]); return [ph(A), P(eq(powH(`(${ph(A)})`, 2)), ph(ppow(A, 2)))]; }),
    S("(a + b)(a − b)", () => { const p = ri(1, 6), q = ri(1, 9), v = coin(0.4) ? "y" : ""; const A = poly([p, { x: 1 }], [q, v ? { y: 1 } : {}]), B = poly([p, { x: 1 }], [-q, v ? { y: 1 } : {}]); const sw = coin(0.3); return [`${ph(A)}`, P(eq(sw ? `(${ph(B)})(${ph(A)})` : `(${ph(A)})(${ph(B)})`), ph(pmul(A, B)))]; }),
    S("(x + a)(x + b)", () => { const a = nz(-9, 9), b = nz(-9, 9); return [`${Math.min(a, b)},${Math.max(a, b)}`, P(eq(`${fac(1, a)}${fac(1, b)}`), ph(pmul(poly([1, { x: 1 }], [a, {}]), poly([1, { x: 1 }], [b, {}]))))]; }),
    S("(ax + b)(cx + d)", () => { const a = ri(1, 5), c = ri(2, 5), b = nz(-7, 7), d = nz(-7, 7); return [`${a}${b}${c}${d}`, P(eq(`${fac(a, b)}${fac(c, d)}`), ph(pmul(poly([a, { x: 1 }], [b, {}]), poly([c, { x: 1 }], [d, {}]))))]; }),
    S("곱셈 공식을 이용한 계산", () => {
      const a = nz(-6, 6), b = nz(-6, 6), c = nz(-6, 6), k = ri(1, 3), op = pick(["+", "−"]);
      const X = (q) => poly([1, { x: 1 }], [q, {}]);
      const A = pscale(ppow(X(a), 2), k), B = pmul(X(b), X(c));
      const r = op === "+" ? padd(A, B) : psub(A, B);
      return [`${k}${a}${op}${b}${c}`, P(eq(`${k > 1 ? k : ""}${powH(fac(1, a), 2)} ${op} ${fac(1, b)}${fac(1, c)}`), ph(r))];
    }, { n: 16 }),
  ] },
  { name: "인수분해", steps: [
    S("공통인수로 묶기", () => {
      const c = ri(2, 6), ex = ri(0, 2), ey = ri(0, 1); if (!ex && !ey && c < 2) return [null];
      const m = poly([c, { x: ex, y: ey }]);
      const t1 = [nz(-5, 5), { x: 1 }], t2 = [nz(-6, 6), coin() ? { y: 1 } : {}], t3 = coin(0.3) ? [nz(-5, 5), { x: 1, y: 1 }] : null;
      const inner = poly(t1, t2, ...(t3 ? [t3] : []));
      const g = [...inner.values()].reduce((s, v) => gcd(s, v.n), 0); if (g > 1 || inner.size < 2) return [null];
      const prod = pmul(m, inner); const neg_ = ph(prod).startsWith(MI);
      const mm = neg_ ? pscale(m, -1) : m, ii = neg_ ? pscale(inner, -1) : inner;
      return [`${ph(m)}|${ph(inner)}`, P(ph(prod), `${monoP(mm, 1, 1)}(${ph(ii)})`)];
    }, { inst: "인수분해하세요." }),
    S("완전제곱식", () => { const p = ri(1, 5), q = nz(-9, 9), v = coin(0.3) ? "y" : ""; if (gcd(p, q) !== 1) return [null]; const A = poly([p, { x: 1 }], [q, v ? { y: 1 } : {}]); return [ph(A), P(ph(ppow(A, 2)), powH(`(${ph(A)})`, 2))]; }, { inst: "인수분해하세요." }),
    S("a² − b² 꼴", () => { const p = ri(1, 7), q = ri(1, 9), v = coin(0.4) ? "y" : ""; if (gcd(p, q) !== 1 || (p === 1 && q === 1 && !v)) return [null]; const A = poly([p, { x: 1 }], [q, v ? { y: 1 } : {}]), B = poly([p, { x: 1 }], [-q, v ? { y: 1 } : {}]); return [`${p}${q}${v}`, P(ph(pmul(A, B)), `(${ph(A)})(${ph(B)})`)]; }, { inst: "인수분해하세요." }),
    S("x² + (a + b)x + ab 꼴", () => { const a = nz(-9, 9), b = nz(-9, 9); if (a + b === 0 || a === b) return [null]; return [`${Math.min(a, b)},${Math.max(a, b)}`, P(quadH(1, a + b, a * b), facS([[1, a], [1, b]]))]; }, { inst: "인수분해하세요." }),
    S("acx² + (ad + bc)x + bd 꼴", () => { const a = ri(1, 3), c = ri(2, 5), b = nz(-7, 7), d = nz(-7, 7); if (gcd(a, b) !== 1 || gcd(c, d) !== 1 || a * d + b * c === 0) return [null]; return [`${a * c},${a * d + b * c},${b * d}`, P(quadH(a * c, a * d + b * c, b * d), `${fac(a, b)}${fac(c, d)}`)]; }, { n: 16, inst: "인수분해하세요." }),
    S("복잡한 식의 인수분해", () => {
      const f = ri(0, 3), a = nz(-6, 6), b = nz(-6, 6);
      if (f === 0) { const k = ri(2, 5); if (a + b === 0 || a === b) return [null]; return [`0${k}${a}${b}`, P(quadH(k, k * (a + b), k * a * b), `${k}${facS([[1, a], [1, b]])}`)]; }
      if (f === 1) { const p = nz(-4, 4); if (a + b === 0 || a === b || p + a === 0 || p + b === 0) return [null]; return [`1${p}${a}${b}`, P(`${powH(fac(1, p), 2)} ${a + b < 0 ? MI : "+"} ${Math.abs(a + b) === 1 ? "" : Math.abs(a + b)}${fac(1, p)} ${a * b < 0 ? MI : "+"} ${Math.abs(a * b)}`, facS([[1, p + a], [1, p + b]]))]; }
      if (f === 2) { const k = ri(1, 3); return [`2${k}`, P(`x<sup>4</sup> ${MI} ${k ** 4}`, `(x<sup>2</sup> + ${k * k})${fac(1, k)}${fac(1, -k)}`)]; }
      return [`3${a}${b}`, P(ph(pmul(poly([1, { x: 1 }], [a, {}]), poly([1, { y: 1 }], [b, {}]))), `${fac(1, a)}(${lin([[1, "y"], [b, ""]])})`)];
    }, { n: 16, inst: "인수분해하세요." }),
  ] },
  { name: "이차방정식", steps: [
    S("인수분해를 이용한 풀이", () => { if (coin(0.7)) { const a = nz(-9, 9), b = nz(-9, 9); return [`${Math.min(a, b)},${Math.max(a, b)}`, P(`${quadH(1, -(a + b), a * b)} = 0`, rootsAns(Q(a), Q(b)))]; } const p = ri(2, 4), q = nz(-7, 7), r = nz(-6, 6); if (gcd(p, q) !== 1) return [null]; return [`${p}${q}${r}`, P(`${quadH(p, -(q + p * r), q * r)} = 0`, rootsAns(Q(q, p), Q(r)))]; }, { inst: "이차방정식을 푸세요." }),
    S("제곱근을 이용한 풀이", () => {
      const f = ri(0, 2), k = ri(2, 30);
      if (f === 0) return [`0${k}`, P(`x<sup>2</sup> = ${k}`, pmRoot(0, 1, k, 1))];
      if (f === 1) { const p = nz(-6, 6); return [`1${p}${k}`, P(`${powH(fac(1, -p), 2)} = ${k}`, pmRoot(p, 1, k, 1))]; }
      const a = ri(2, 5), c = a * ri(1, 12); return [`2${a}${c}`, P(`${a}x<sup>2</sup> ${MI} ${c} = 0`, pmRoot(0, 1, c / a, 1))];
    }, { inst: "이차방정식을 푸세요." }),
    S("완전제곱식을 이용한 풀이", () => { const h = nz(-5, 5), D = ri(2, 20), c = h * h - D; if (Number.isInteger(Math.sqrt(D))) return [null]; return [`${h}${D}`, P(`${quadH(1, 2 * h, c)} = 0`, pmRoot(-h, 1, D, 1))]; }, { inst: "완전제곱식을 이용하여 푸세요." }),
    S("근의 공식을 이용한 풀이", () => { const a = ri(1, 5), b = ri(-9, 9), c = nz(-9, 9), D = b * b - 4 * a * c; if (D <= 0 || Number.isInteger(Math.sqrt(D))) return [null]; return [`${a}${b}${c}`, P(`${quadH(a, b, c)} = 0`, pmRoot(-b, 1, D, 2 * a))]; }, { n: 16, inst: "근의 공식을 이용하여 푸세요." }),
    S("괄호·분수·소수가 있는 이차방정식", () => {
      const p = nz(-6, 6), q = nz(-6, 6), f = ri(0, 2), B = -(p + q), C = p * q;
      if (f === 0) { const a = nz(-4, 4), b = nz(-4, 4), k = a + b - B, m = a * b - C; return [`0${p}${q}${a}${b}`, P(`${fac(1, a)}${fac(1, b)} = ${L(k, m)}`, rootsAns(Q(p), Q(q)))]; }
      if (f === 1) { const d = ri(2, 4); return [`1${p}${q}${d}`, P(`${lin([[Q(1, d), "x2"], [Q(B, d), "x"], [Q(C, d), ""]])} = 0`, rootsAns(Q(p), Q(q)))]; }
      if (Math.abs(B) > 9 || Math.abs(C) > 30) return [null];
      return [`2${p}${q}`, P(`0.1x<sup>2</sup> ${B < 0 ? MI : "+"} ${ds(Math.abs(B), 1)}x ${C < 0 ? MI : "+"} ${ds(Math.abs(C), 1)} = 0`.replace(" + 0x", "").replace(` ${MI} 0x`, ""), rootsAns(Q(p), Q(q)))];
    }, { n: 16, inst: "이차방정식을 푸세요." }),
  ] },
  { name: "이차함수", steps: [
    S("y = a(x − p)² + q 꼴로 나타내기", () => { const a = nz(-3, 3), p = nz(-5, 5), q = ri(-9, 9); const b = -2 * a * p, c = a * p * p + q; return [`${a}${p}${q}`, P(`y = ${quadH(a, b, c)}`, `y = ${a === 1 ? "" : a === -1 ? MI : N(a)}${powH(fac(1, -p), 2)}${q ? (q < 0 ? ` ${MI} ${-q}` : ` + ${q}`) : ""}, 꼭짓점 (${N(p)}, ${N(q)})`)]; }, { n: 12, inst: "y = a(x − p)² + q 꼴로 나타내고 꼭짓점을 구하세요." }),
  ] },
];

// ---------- 목차 ----------
const GR = [["E1", "초1", E1], ["E2", "초2", E2], ["E3", "초3", E3], ["E4", "초4", E4], ["E5", "초5", E5], ["E6", "초6", E6], ["M1", "중1", M1], ["M2", "중2", M2], ["M3", "중3", M3]];
const STEPS = new Map();
export const CURRICULUM = GR.map(([g, label, units]) => ({
  g, label,
  units: units.map((u, ui) => {
    const L_ = String.fromCharCode(65 + ui);
    const steps = u.steps.map((st, si) => {
      const id = `${g}${u.sem || ""}${L_}${si + 1}`;
      const info = { id, g, label, sem: u.sem, unit: u.name, no: si + 1, total: u.steps.length, title: st.t, n: st.n || 20, v: !!st.v, spec: st };
      STEPS.set(id, info);
      return info;
    });
    return { name: u.name, sem: u.sem, steps };
  }),
}));
export const stepOf = (id) => STEPS.get(id);
const CIRC = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮";
export const circ = (n) => CIRC[n - 1] || `(${n})`;

// 문제지 번호: ID-씨앗(4글자)[-V]
export const makeCode = (id, vertical) => `${id}-${newSeed()}${vertical ? "-V" : ""}`;
export function parseCode(code) {
  const m = /^([EM]\d{1,2}[A-H]\d{1,2})-([A-Z2-9]{4})(-V)?$/.exec(String(code || "").trim().toUpperCase());
  if (!m || !STEPS.has(m[1])) return null;
  return { id: m[1], seed: m[2], vertical: !!m[3] && STEPS.get(m[1]).v };
}
export function makeSheet(code) {
  const c = parseCode(code); if (!c) return null;
  const st = STEPS.get(c.id), sp = st.spec;
  R = mulberry(seedNum(c.id, c.seed));
  const n = c.vertical ? sp.vn || sp.n || 20 : sp.n || 20;
  const out = [], seen = new Set();
  for (let t = 0; out.length < n && t < 30000; t++) {
    const [k, p] = sp.mk();
    if (k == null || seen.has(k)) continue;
    seen.add(k); out.push(p);
  }
  R = Math.random;
  return { code: `${c.id}-${c.seed}${c.vertical ? "-V" : ""}`, step: st, vertical: c.vertical, probs: out };
}

// ---------- 그리기 ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const kickOf = (st) => (st.g[0] === "E" ? `${st.g[1]}학년 ${st.sem}학기` : `중학교 ${st.g[1]}학년`) + ` · ${st.unit}`;
const vHtml = (v, big) => {
  if (v.t === "div") return `<div class="ws-ld"><span class="ws-dv">${v.dv}</span><span class="ws-dd">${v.dd}</span></div>`;
  return `<div class="ws-v${big ? " big" : ""}"><div>${v.a}</div><div class="ws-ln"><span>${v.op}</span>${v.b}</div><div class="ws-ans"></div></div>`;
};
export function sheetHtml(sh, qr) {
  const st = sh.step, sp = st.spec, n = sh.probs.length;
  const cols = sh.vertical ? sp.vc || 4 : sp.cols || 2;
  const rows = Math.ceil(n / cols);
  const isDiv = sh.vertical && sh.probs[0]?.v?.t === "div";
  const inst = sp.inst || (isDiv ? (sh.probs.some((p) => String(p.a).includes("···")) ? "나눗셈을 하여 몫과 나머지를 구하세요." : "나눗셈을 하세요.") : "계산하세요.");
  const body = sh.probs.map((p, i) => sh.vertical
    ? `<div class="ws-qv${isDiv ? " div" : ""}"><b>${i + 1}</b>${vHtml(p.v, sp.big)}</div>`
    : `<div class="ws-q"><b>${i + 1}</b><span>${p.q}</span></div>`).join("");
  return `<section class="ws-page">
  <header class="ws-top"><div><div class="ws-kick">바나나북코드 연산 · ${esc(kickOf(st))}</div><div class="ws-tt">${st.no}) ${esc(st.title)}</div><div class="ws-sub">${esc(st.unit)} · ${st.total}단계 중 ${st.no}단계${sh.vertical ? " · 세로셈" : ""}</div></div>
  ${qr ? `<div class="ws-qr">${qr}<div>정답 보기</div></div>` : ""}</header>
  <div class="ws-meta"><span>이름</span><span>날짜</span><span>맞은 개수 &nbsp;&nbsp;&nbsp;&nbsp;/ ${n}</span></div>
  <p class="ws-inst">${inst}</p>
  <div class="${sh.vertical ? "ws-gv" : "ws-g"}" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr)">${body}</div>
  <footer class="ws-foot"><span>문제지 번호 ${sh.code}</span><span>banana bookcode</span></footer>
</section>`;
}
const plainLen = (h) => String(h).replace(/<[^>]+>/g, "").length;
export const answersBlock = (sh) => `<div class="ws-ak"><div class="ws-akh"><b>${sh.step.no}) ${esc(sh.step.title)}</b><span>${sh.code}</span></div>
  <ol class="ws-akl${sh.probs.some((p) => plainLen(p.a) > 22) ? " wide" : ""}">${sh.probs.map((p) => `<li><span>${p.a}</span></li>`).join("")}</ol></div>`;
export const answerPageHtml = (sheets) => `<section class="ws-page ws-apage"><header class="ws-top"><div><div class="ws-kick">바나나북코드 연산</div><div class="ws-tt">정답</div></div></header>${sheets.map(answersBlock).join("")}<footer class="ws-foot"><span></span><span>banana bookcode</span></footer></section>`;

// QR (정답 보기 주소) — 처음 쓸 때만 불러옴
let qrMod = null;
export async function qrSvg(text) {
  try {
    qrMod ||= (await import("https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm")).default;
    const q = qrMod(0, "M"); q.addData(text); q.make();
    const n = q.getModuleCount(); let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#22252A"/></svg>`;
  } catch { return ""; }
}
