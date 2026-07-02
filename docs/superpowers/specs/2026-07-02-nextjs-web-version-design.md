# 영수증 스캔 OCR — Next.js 웹버전 디자인

2026-07-02. RN 앱(app/)과 동일 기능의 웹버전을 `web/`에 추가한다.

## 목적

기존 프로바이더 A/B 테스트 하니스를 브라우저에서도 쓴다.
데스크톱(파일 업로드·드래그&드롭)과 모바일 브라우저(카메라 촬영) 모두 지원.

## 아키텍처

- **Next.js 15 (App Router), JavaScript** — RN 앱과 같은 JS. UI 라이브러리 없음, 일반 CSS.
- **백엔드 연동: rewrite 프록시.** `next.config.mjs`의 rewrite로 `/receipt` →
  `RECEIPT_API`(기본 `http://localhost:8000`)로 프록시. server.py 무수정, CORS 불필요.
  폰은 `http://<맥-LAN-IP>:3005` 하나만 알면 된다.

```
web/
  next.config.mjs      # rewrite: /receipt → RECEIPT_API
  app/page.js          # 단일 페이지 (전체 UI, 클라이언트 컴포넌트)
  app/globals.css
  lib/compress.js      # canvas 리사이즈 1600px + JPEG q0.7
```

## 화면 (앱의 5개 모드 재현)

`idle | analyzing | success | result | problem`

- **프로바이더 세그먼트**: OpenAI / Gemini / Gemma 3 / Gemma 4 / Textract / Doc AI.
  서버 `PROVIDERS` 키와 일치. 분석 중에는 잠금.
- **이미지 입력**:
  - 데스크톱: 클릭 업로드 + 드래그&드롭
  - 모바일: `<input type="file" accept="image/*" capture="environment">` → 네이티브 카메라.
    getUserMedia 커스텀 카메라는 만들지 않는다 (네이티브 input이 커버).
- **결과 화면**: 메트릭 바(모델 · 응답속도 ms · 합계검증) + 영수증 카드.
  - 필드 완성도 N/4 (상호·날짜·총액·품목)
  - 합계 불일치 → 주황 "합계 확인" 경고 배지 (차단 아님)
  - 구조 추출 실패, raw_text만 있으면 → TEXT 배지 카드
  - 결측 필드는 "상호 미상 / 날짜 미상 / —" 표기
- **히스토리**: 세션 내 최근 시도 목록 (메모리 state, 새로고침 시 초기화)

## 데이터 흐름

```
파일 선택 → canvas 압축(최대 1600px, JPEG q0.7)
  → POST /receipt (FormData: file=이미지, provider=<키> — 둘 다 Form 필드)
  → Next rewrite → FastAPI server.py → 응답 JSON
  → { receipts, needs_retake, model, latency_ms } 렌더
```

압축 파라미터(1600px, q0.7)는 앱과 동일 — 감열지 작은 글씨 하한선이므로 줄이지 말 것.

## 에러 처리 (앱과 동일 분기)

| 상황 | 처리 |
|------|------|
| HTTP 4xx/5xx | `problem` — "서버 오류 (HTTP nnn)" |
| fetch throw | `problem` — "서버에 연결하지 못했습니다" |
| `needs_retake` | `problem` — 흐림/결측 안내, "다시 촬영" |
| 정상 | `success` 체크 표시 → `result` 카드 |

## 실행 통합 (sh + Docker 양쪽)

**sh (개발용):** `dev.sh`에 웹 기동 추가 — 백엔드 시작 후 `web/`에서 `next dev`(3005)를
백그라운드로 띄우고, 마지막에 기존대로 `expo run:ios` 실행. 한 번에 서버+웹+앱 모두 기동.
포트 3005도 기동 전 정리 대상에 포함.

**Docker (배포/무설치 실행):** `web/Dockerfile`(node 알파인, `next build` + `next start`) 추가,
루트에 `docker-compose.yml`로 두 서비스 구성:
- `api`: 기존 Dockerfile (8000)
- `web`: web/Dockerfile (3005), `RECEIPT_API=http://api:8000` — compose 내부 네트워크로 연결

`docker-run.sh`는 `docker compose up --build`를 부르도록 확장 (키 주입 방식은 기존 그대로:
`.openai_key`/`.google_key`/`.env.local`). 기존 단독 백엔드 실행도 `docker compose up api`로 가능.

## 검증

- `lib/compress.js` 리사이즈 비율 계산에 셀프체크 1개 (assert)
- 수동 QA: ① 데스크톱 업로드 → 결과 카드 ② 폰 카메라 → 결과 카드 ③ 서버 꺼짐 → 에러 화면

## 하지 않는 것

- getUserMedia 커스텀 카메라 UI, 문서 엣지 감지 (네이티브 앱 전용 기능)
- 히스토리 영속화 (localStorage 등) — 필요해지면 추가
- TypeScript, UI 라이브러리, 상태관리 라이브러리
