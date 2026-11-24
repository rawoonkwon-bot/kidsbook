// 엄마 얼굴: 손그림 낙서 얼굴 (표정 8 × 색 8) — 바나나북코드 오리지널
export const FACE_COLORS = ["#F2D16B", "#B7C9A8", "#F4B8B0", "#9EC3D6", "#C9B7DC", "#E8B07A", "#A8C7BE", "#D9D3C7"];
const SH = [
  "M50 8C76 6 93 26 92 52C91 78 72 94 48 92C22 90 7 72 8 47C9 22 26 9 50 8Z",
  "M48 6C74 8 90 30 92 54C94 80 74 95 50 94C24 93 6 76 7 50C8 26 24 5 48 6Z",
  "M50 10C72 9 86 28 88 50C92 78 80 96 50 95C22 94 9 80 12 52C14 28 28 11 50 10Z",
  "M52 7C78 10 94 32 91 57C88 82 68 95 46 93C20 90 6 70 9 46C12 22 30 5 52 7Z",
];
const L = 'stroke="#2B2B2B" stroke-width="3.6" stroke-linecap="round" fill="none"';
const FACES = [
  `<circle cx="38" cy="46" r="3.6" fill="#2B2B2B"/><circle cx="62" cy="46" r="3.6" fill="#2B2B2B"/><path d="M40 60q10 9 20 0" ${L}/>`,
  `<path d="M33 47q5-5 10 0" ${L}/><path d="M57 47q5-5 10 0" ${L}/><path d="M42 60q8 6 16 0" ${L}/><circle cx="30" cy="57" r="4" fill="#E98A7E" opacity=".6"/><circle cx="70" cy="57" r="4" fill="#E98A7E" opacity=".6"/>`,
  `<circle cx="38" cy="46" r="3.6" fill="#2B2B2B"/><path d="M57 46l9-3M57 46l9 3" ${L}/><path d="M40 60q10 8 20 0" ${L}/>`,
  `<circle cx="38" cy="47" r="3.6" fill="#2B2B2B"/><circle cx="62" cy="47" r="3.6" fill="#2B2B2B"/><path d="M43 62h14" ${L}/>`,
  `<path d="M33 48q5 4 10 0" ${L}/><path d="M57 48q5 4 10 0" ${L}/><circle cx="50" cy="62" r="3" fill="#2B2B2B"/>`,
  `<circle cx="38" cy="45" r="3.6" fill="#2B2B2B"/><circle cx="62" cy="45" r="3.6" fill="#2B2B2B"/><ellipse cx="50" cy="61" rx="4.5" ry="5.5" ${L}/>`,
  `<path d="M33 46q5-5 10 0" ${L}/><path d="M57 46q5-5 10 0" ${L}/><path d="M40 57q10 10 20 0z" fill="#2B2B2B"/><path d="M46 63q4 4 8 0" fill="#E98A7E"/>`,
  `<circle cx="36" cy="47" r="7" ${L}/><circle cx="64" cy="47" r="7" ${L}/><path d="M43 47h14" ${L}/><path d="M43 63q7 5 14 0" ${L}/>`,
];
export const FACE_COUNT = FACES.length;
const idx = (v, n) => { const i = Math.floor(Number(v)); return Number.isFinite(i) ? ((i % n) + n) % n : 0; };
// face: { f, c } — 다른 사람이 저장한 값도 숫자로만 써서 안전하게 그림
export const validFace = (face) => !!face && typeof face === "object" && Number.isFinite(Number(face.f)) && Number.isFinite(Number(face.c));
export function faceSvg(face) {
  const f = idx(face?.f, FACES.length), c = idx(face?.c, FACE_COLORS.length);
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${SH[f % SH.length]}" fill="${FACE_COLORS[c]}"/>${FACES[f]}</svg>`;
}
