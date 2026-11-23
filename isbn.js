// ISBN 정규화 · 검증 유틸
// 영어책 바코드 옆의 5자리 가격 바코드(EAN-5 add-on, 예: 51699)나
// 978/979가 아닌 상품 바코드를 걸러내서 오인식으로 재시도하는 일을 없앤다.

const digitsOnly = (s) => String(s || "").replace(/[^0-9Xx]/g, "").toUpperCase();

export function isValidEan13(code) {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

export function isValidIsbn10(code) {
  if (!/^\d{9}[\dX]$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (code[i] === "X" ? 10 : Number(code[i])) * (10 - i);
  return sum % 11 === 0;
}

export function isbn10to13(isbn10) {
  const core = "978" + isbn10.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
  return core + ((10 - (sum % 10)) % 10);
}

export function isbn13to10(isbn13) {
  if (!isbn13.startsWith("978")) return null; // 979 계열은 ISBN-10이 없음
  const core = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? "X" : String(check));
}

/**
 * 스캔/입력된 문자열을 ISBN-13으로 정규화. 책 바코드가 아니면 null.
 * - EAN-13 + add-on이 붙어서 18자리(13+5) 혹은 15자리(13+2)로 들어와도 앞 13자리만 사용
 */
export function toIsbn13(raw) {
  let s = digitsOnly(raw);
  if (s.length === 18 || s.length === 15) s = s.slice(0, 13);
  if (s.length === 13) {
    return (s.startsWith("978") || s.startsWith("979")) && isValidEan13(s) ? s : null;
  }
  if (s.length === 10 && isValidIsbn10(s)) return isbn10to13(s);
  return null;
}
