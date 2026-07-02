# snapdoc — zero-dependency 웹 문서 스캐너 라이브러리 디자인

2026-07-02. 가볍고(≈25KB) 빠르고(WebGPU 워핑) 정확한 오픈소스 문서/영수증 스캐너.
GitHub 스타 전략: jscanify(OpenCV.js 8MB)의 무게 문제를 정면 공략 — "zero-dep + WebGPU-accelerated".

## 정체성

- 가칭 `snapdoc` (npm 공개 시 중복 확인 후 확정). 라이선스 MIT, 코드 100% 자체 작성.
- 위치: `ocr-mvp/snapdoc/` — 독립 npm 패키지 (자체 package.json, 추후 리포 분리 가능)
- 의존성 0. TypeScript. ESM 출력 + 타입 내장.

## 공개 API (5개)

```ts
type Quad = { tl: Point, tr: Point, br: Point, bl: Point };  // Point = {x,y} 원본 좌표계
type ScanResult = { canvas: HTMLCanvasElement, quad: Quad | null, blur: number };

detect(src: CanvasImageSource | ImageData): Quad | null      // 문서 코너 감지
warp(src, quad, opts?: { maxSize?: number }): HTMLCanvasElement  // 원근 보정 크롭
quality(src): { blur: number, ok: boolean }                  // 흐림 점수(라플라시안 분산)
scan(file: Blob, opts?): Promise<ScanResult>                 // detect+warp+quality 원샷. quad 없으면 원본 유지
highlight(video: HTMLVideoElement, overlay: HTMLCanvasElement): () => void  // 라이브 코너 하이라이트, 반환값=stop
```

## 아키텍처 — 단계별 성능 분리 (2026 조사 결론)

- **detect: 순수 TS** — 360px 축소 해상도에서 처리. GPU는 readback 지연 때문에 오히려 손해.
  라이브 프레임마다 도는 경로라 CPU가 정답. 목표 <15ms(폰).
- **warp: WebGPU(~85% 커버) + 순수 TS bilinear 폴백** — 원본 해상도 원근 보정은 GPU 텍스처
  샘플링의 본업(<5ms). 폴백 CPU는 ~50ms — 원샷 스캔엔 충분. WebGL2 중간 폴백은 백엔드
  유지보수 비용 대비 실익 없어 제외.
- **quality: 순수 TS** — 축소 해상도 라플라시안.
- WASM SIMD 제외: 툴체인+번들 비용 대비 낄 자리 없음.

## 내부 모듈

```
snapdoc/src/
  gray.ts      : RGBA → grayscale Float32 + 대비 스트레칭 (감열지 보정 지점)
  edge.ts      : Sobel 그래디언트 → 임계값 이진 엣지맵
  quad.ts      : 엣지맵 → 외곽 스캔 라인 후보 → 최대 볼록 사각형 스코어링(면적+직각성)
  homography.ts: 4점 대응 → 3x3 호모그래피 행렬 (DLT, 가우스 소거)
  warp-cpu.ts  : 역방향 매핑 + bilinear
  warp-gpu.ts  : WebGPU 파이프라인 (WGSL 셰이더 문자열 내장)
  blur.ts      : 라플라시안 분산
  index.ts     : 공개 API — DOM 변환(ImageBitmap/canvas ↔ ImageData)은 여기서만
```

핵심 규칙: **gray/edge/quad/homography/warp-cpu/blur는 DOM 무접촉** — `{data, width, height}`
평면 객체만 다룬다 → node에서 합성 이미지로 단위 테스트 가능. DOM/GPU는 index.ts와 warp-gpu.ts에 격리.

## 정확도 전술

- 감지 전 대비 스트레칭(히스토그램 2%~98% 클리핑) — 감열지 저대비 대응
- quad 스코어: 면적 × 직각성(코사인 페널티) × 엣지 커버리지 — 최대 사각형이 아니라 "가장 문서다운" 사각형
- 감지 실패 시 null 반환 — scan()은 원본 그대로 진행 (실패가 차단이 되지 않게, ocr-mvp 품질게이트 철학과 동일)

## 테스트

- 모듈별 node 단위 테스트 (node:test): 합성 이미지 — 검은 배경 흰 기울어진 사각형 → detect가 코너 ±2px,
  warp 후 픽셀 값 검증, blur는 선명/블러 합성 쌍 비교
- 실전 검증: ocr-mvp 웹버전(web/)에 붙여 영수증 인식률 전/후 비교 (내장 테스트베드)

## 스타 전략 (제품의 절반)

- README(영문): 첫 화면에 비교표(jscanify 8MB vs snapdoc ~25KB), 라이브 데모 GIF, 3줄 퀵스타트
- demo/: GitHub Pages용 정적 데모 — 카메라 켜면 즉시 하이라이트+스캔 (설치 없이 체험)
- ESM + 타입 내장, 프레임워크 무관, React 예제 포함

## 하지 않는 것 (v1)

- ML 백엔드(ONNX), WASM SIMD, WebGL2 폴백 — 인터페이스만 교체 가능하게 유지
- 다중 문서 감지, 글레어 억제, 긴 영수증 스티칭 — v2 후보
- npm 배포 자체는 v1 범위 밖 (패키지 구조만 배포 가능하게)
