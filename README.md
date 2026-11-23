# 키즈북코드 웹 (바코드 독서기록)

책 뒤 ISBN 바코드를 찍으면 책 정보를 찾아 독서기록을 남기는 웹앱.

- 바코드 인식: 네이티브 BarcodeDetector(안드로이드 크롬) / zxing-wasm(아이폰 등), EAN-13 전용 + 가이드 영역만 해석
- 도서 조회: 카카오 책 검색(한글책) · Google Books · Open Library 동시 요청, 먼저 찾은 결과 사용 + 로컬 캐시
- 한국 발행 도서(978-89, 979-11)는 카카오 결과를 우선 사용
- 기록은 브라우저(localStorage)에 저장

## 설정
Vercel 환경변수 `KAKAO_REST_KEY`에 카카오 REST API 키를 넣어야 한글책 조회가 동작해요.
환경변수를 바꾼 뒤에는 다시 배포해야 적용돼요.

GitHub main 브랜치에 올리면 Vercel이 자동 배포해요.
