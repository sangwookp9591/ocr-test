# 영수증 스캔 MVP

카메라(네이티브 문서 스캐너) → 압축 → 서버 VLM → JSON → 품질 게이트.

```
[RN 앱] DocumentScanner ─ auto-capture/crop/deskew ─▶ 압축(1600px,q0.7)
   │                        iOS: VisionKit / Android: ML Kit
   ▼
POST /receipt  ─▶ [server.py] ocr_test.extract() ─▶ OpenAI Vision(Structured Output)
   ▼
{ receipts:[{merchant,date,total,currency,items,total_matches_items}], needs_retake }
```

**edge/crop/deskew/perspective/filter는 네이티브 SDK가 처리** — 앱은 압축만, 서버는 추출·검증만.

---

## 0. 준비물

| 항목 | 값 |
|------|----|
| Python | 3.14 (`.venv` 이미 생성됨) |
| Node / Expo | Expo SDK 52, RN 0.76 |
| OpenAI 키 | `.openai_key` 파일 또는 `OPENAI_API_KEY` env |
| 실기기 서명(iOS) | 개인 팀 `QRW9X3848W` (알파·지보 조직팀 아님) |
| 네트워크 | **PC와 폰이 같은 WiFi** (실기기가 PC LAN IP로 접속) |

---

## 1. 서버 실행

### 의존성 설치 (최초 1회)
```bash
.venv/bin/pip install -r requirements.txt
```

### 키 넣기 (아무 방법이나 하나)
```bash
echo "sk-..." > .openai_key          # 파일에 저장 (start.sh가 자동으로 읽음)
# 또는
export OPENAI_API_KEY=sk-...
```

### 시작
```bash
bash start.sh                # .openai_key 자동 사용
# 또는
OPENAI_API_KEY=sk-... bash start.sh
# 또는
bash start.sh sk-...
```

`--host 0.0.0.0` 으로 떠서 LAN의 다른 기기(폰)에서도 접속 가능.

### 키/네트워크 없이 로직만 점검
```bash
.venv/bin/python server.py --selfcheck    # 품질 게이트 로직 assert 통과 확인
```

### 헬스체크
```bash
curl http://localhost:8000/health         # {"ok": true}
```

---

## 2. IP 주소 매칭 (실기기 접속의 핵심)

실기기는 `localhost`로 PC 서버에 접속할 수 없다. **PC의 LAN IP** 를 써야 하고,
이 IP가 아래 두 곳에서 일치해야 한다.

### ① PC의 현재 LAN IP 확인
```bash
ipconfig getifaddr en0        # WiFi 인터페이스. 예) <YOUR_LAN_IP>
```
> `en0`에 안 나오면 `en1` 시도. WiFi를 옮기거나 재접속하면 IP가 바뀔 수 있음.

### ② 두 곳에 같은 IP를 반영

**`app/.env`** — 앱이 실제로 접속하는 주소 (반드시 일치해야 함):
```
EXPO_PUBLIC_RECEIPT_API=http://<YOUR_LAN_IP>:8000/receipt
```

**`start.sh` 11번째 줄** — 시작 시 출력되는 안내 문구 (표시용, 접속엔 무관하지만 맞춰두면 헷갈리지 않음):
```bash
echo "▶ 서버 시작: http://<YOUR_LAN_IP>:8000  (Ctrl+C로 종료)"
```

### ③ 매칭 검증
폰과 같은 WiFi에서, 폰 브라우저로 `http://<PC-LAN-IP>:8000/health` 접속 → `{"ok": true}` 나오면 성공.

> **자주 겪는 실패**
> - `.env`에 `localhost` → 실기기에서 연결 안 됨. 반드시 LAN IP.
> - IP는 맞는데 연결 안 됨 → PC 방화벽이 8000 포트 차단, 또는 폰/PC가 다른 WiFi.
> - `.env` 수정 후엔 **앱을 다시 빌드/재시작**해야 반영됨 (`EXPO_PUBLIC_*`는 번들 시점에 주입).

---

## 3. 앱 빌드 (Expo dev build)

네이티브 문서 스캐너(`react-native-document-scanner-plugin`)를 쓰므로 **Expo Go 불가** — dev build 필요.

```bash
cd app
npm install
npx expo prebuild            # 네이티브 프로젝트(ios/android) 생성
```

### iOS 실기기
```bash
npx expo run:ios --device
```
- Xcode에서 서명 팀을 **개인 팀 `QRW9X3848W`** 로 지정 (조직팀 아님).
- `app.json`의 `NSLocalNetworkUsageDescription` 때문에 첫 실행 시 로컬 네트워크 권한 팝업 → 허용해야 서버 접속됨.

### Android 실기기
```bash
npx expo run:android
```

### 개발 서버(Metro) 재시작만
```bash
cd app && npm start          # expo start --dev-client
```

> `.env`를 바꿨으면 `npm start` 재시작만으론 부족할 수 있음 — 캐시 클리어 `npx expo start --dev-client -c`.

---

## 4. 품질 게이트

- `needs_retake` = 총액이 있거나 텍스트라도 읽힌 영수증이 하나도 없을 때 → 앱이 "다시 촬영" 안내.
- `total_matches_items` = 항목 합 == 인쇄 총액 (숫자 인식 신뢰도 신호). **상품명 오타는 못 잡음.**
- Vision `detail:high`에서 숫자 인식은 ~100%지만 상품명은 ~80% 수준.

---

## 5. 프로바이더 A/B 테스트 (앱에서 세그먼트 전환)

여러 VLM을 **같은 영수증으로 번갈아 테스트**한다. 앱 상단 세그먼트 버튼으로 고르면
그 프로바이더로 전송되고, 결과 상단에 **모델 · 응답속도(ms) · 합계검증**, 카드에 **필드 완성도(N/4)** 가 뜬다.

### 두 종류의 프로바이더
```
[VLM]   이미지 ─▶ LLM(멀티모달) ─▶ JSON            비쌈, 유연(어떤 영수증도), 상품명 강함
[파서]  이미지 ─▶ OCR+좌표 ─▶ Rule Engine ─▶ 필드   저렴, 정형 영수증에 강함, 좌표 기반
           (AWS/GCP가 이 파이프라인을 통째로 처리 → 우리는 필드 매핑만)
```
전용 파서(Textract·Doc AI)는 OCR·좌표추출·필드추출을 클라우드가 다 하고, 앱/서버는 **그 결과를 우리 스키마로 매핑**(`_map_textract` / `_extract_docai`)만 한다. 그래서 VLM보다 싸고 빠를 수 있다 — 그걸 이 하니스로 직접 비교.

### 지원 프로바이더 (`ocr_test.PROVIDERS`)
| 세그먼트 | 종류 | 모델/API(기본) | 엔드포인트 | 자격증명 | 구조화 출력 |
|----------|------|---------------|-----------|---------|-----------|
| OpenAI | VLM | `gpt-5.5` | OpenAI | `OPENAI_API_KEY` | ✅ json_schema |
| Gemini | VLM | `gemini-2.5-flash` | Google AI (OpenAI 호환) | `GOOGLE_API_KEY` | ✅ json_schema |
| Gemma 3 | VLM | `gemma-3-27b-it` | Google AI (OpenAI 호환) | `GOOGLE_API_KEY` | ⚠️ 폴백 |
| Gemma 4 | VLM | `GEMMA4_MODEL`(기본 3으로 폴백) | Google AI | `GOOGLE_API_KEY` | ⚠️ 폴백 |
| Textract | 파서 | AnalyzeExpense | AWS Textract | AWS 자격증명 | 파서 자체가 구조화 |
| Doc AI | 파서 | Expense Parser | GCP Document AI | GCP 서비스계정 | 파서 자체가 구조화 |

> **VLM**: Google AI는 OpenAI 호환 엔드포인트(`.../v1beta/openai/`) 제공 → OpenAI SDK를 `base_url`만 바꿔 재사용. Gemma는 json_schema가 불안정 → best-effort 파싱, 실패 시 응답 원문을 `raw_text`로 표시.
> **파서**: SDK(`boto3`, `google-cloud-documentai`)는 **호출 시점에만 import** → 자격증명 없이 VLM만 쓰면 설치 불필요. 미설정 시 그 프로바이더만 502로 안내.

### 파서 자격증명 셋업 (쓸 것만)
**AWS Textract** — `~/.aws/credentials` 또는 env. 리전 기본 `ap-northeast-2`.
```bash
export AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...  AWS_REGION=ap-northeast-2
```
**Google Document AI** — Gemini/Gemma의 `GOOGLE_API_KEY`와 **다른 키**를 씀. GCP 콘솔에서 **Expense Parser 프로세서**를 먼저 생성 후:
```bash
export DOCAI_PROJECT=my-project  DOCAI_LOCATION=us  DOCAI_PROCESSOR_ID=abc123
export DOCAI_API_KEY=AIza...     # Doc AI 전용 API 키
# (API 키 대신 서비스계정을 쓰려면 DOCAI_API_KEY 대신 GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json)
```

### 키 넣기 (Gemini/Gemma 쓰려면 Google 키 필요)
```bash
echo "sk-..." > .openai_key       # OpenAI
echo "AIza..." > .google_key      # Google AI Studio (Gemini + Gemma 공용). start.sh가 자동 로드.
```

### 모델명 바꾸기 (전부 env로 덮어쓰기)
```bash
GEMINI_MODEL=gemini-2.5-pro GEMMA4_MODEL=gemma-4-... bash start.sh
```

### 측정 지표의 의미
- **응답속도** = 서버가 `extract()` 왕복에 걸린 시간(ms). 네트워크 포함, 상대 비교용.
- **합계검증** = 항목 합 == 총액 (숫자 인식 신뢰도). 상품명 오타는 못 잡음.
- **필드 완성도 N/4** = 상호·날짜·총액·품목 중 몇 개를 뽑았나. 정답지가 없으니 **상대 비교 프록시**다 (진짜 정확도는 사람이 확인).

### 새 프로바이더 추가
`ocr_test.PROVIDERS`에 한 줄 추가(`base_url`/`key_env`/`model`/`schema`) → 앱 `App.js`의 `PROVIDERS` 배열에 세그먼트 한 칸 추가. 끝.

---

## 6. 흐림·결측·실패 처리 워크플로우

각 단계에서 무엇이 실패할 수 있고, 어떻게 처리되는지. **차단(재촬영)** 과 **부분 표시** 를 구분한다.

```
① 캡처 ─▶ ② 압축 ─▶ ③ 전송 ─▶ ④ 서버 추출 ─▶ ⑤ 품질 게이트 ─▶ ⑥ 화면 분기
```

### ① 캡처 (`App.scan`)
- 기본: 네이티브 `DocumentScanner` (auto-capture/crop/deskew). 흐림·기울어짐은 여기서 1차 보정.
- 스캐너가 throw → **자동으로 갤러리(`ImagePicker`) 폴백**. 사용자 취소 시 조용히 종료(`return`).

### ② 압축 (`ImageManipulator`)
- `resize width:1600` + `compress:0.7` JPEG. 원본이 커도 서버 전송/토큰 비용을 일정하게 유지.
- 1600px는 감열지 작은 글씨가 살아있는 하한선. 더 줄이면 인식률 하락 → 건드리지 말 것.

### ③ 전송 (`fetch` multipart)
| 상황 | 처리 |
|------|------|
| `res.ok === false` (HTTP 4xx/5xx) | `problem` 모드 → "서버 오류 (HTTP nnn)" |
| `fetch` throw (네트워크·IP 불일치·방화벽) | `problem` 모드 → "서버에 연결하지 못했습니다" + 원인 메시지 |
> 연결 실패의 대부분은 **IP 매칭 문제** — [2. IP 주소 매칭] 참고.

### ④ 서버 추출 (`ocr_test.extract` → Vision Structured Output)
- **읽을 수 없는 값은 `null`** 로 채운다 (스키마가 `["string","null"]` 등으로 허용). 크래시 없이 부분 결과 반환.
- **`raw_text` 안전망**: 영수증 구조를 못 나눠도, 이미지에 보이는 모든 텍스트를 원문 그대로 담는다. → 최소한 "읽긴 했다"는 신호.
- 감열지 흐림 대응: `OPENAI_DETAIL=high` 기본 (low로는 작은 글씨 못 읽음).

### ⑤ 품질 게이트 (`server.summarize`)
| 판정 | 조건 | 의미 |
|------|------|------|
| `needs_retake = true` | 총액도 `raw_text`도 없는 게 **모든** 영수증 | 아무것도 못 읽음 → 재촬영 |
| `needs_retake = false` | 총액이 있거나 텍스트라도 읽힘 | 통과(부분이라도) |
| `total_matches_items = false` | 항목 합 ≠ 인쇄 총액 | 숫자 오인식 의심 (경고일 뿐, **차단 아님**) |
> `total_matches_items`는 **숫자** 신뢰도만 본다. 상품명 오타(~20%)는 못 잡음 — 사람이 확인해야 함.

### ⑥ 화면 분기 (`App` mode)
| 결과 | 화면 |
|------|------|
| `needs_retake` | `problem` — ⚠ 흔들림 + 경고 햅틱, "흐리거나 상호·날짜·총액이 안 보입니다" → **다시 촬영** |
| 정상 | `success` 체크 애니메이션(1.25s) → `result` 카드 |
| 상호·총액·품목 전부 없고 `raw_text`만 | `result` 안에 **TEXT 배지 카드** (원문만 표시) |
| 총액 있으나 합계 불일치 | 카드에 **"합계 확인" 경고 배지** (주황) — 표시는 하되 사용자 검토 유도 |
| 일부 필드만 결측 | "상호 미상 / 날짜 미상 / —"로 표시, 나머지는 정상 노출 |

### 요약: 재촬영은 언제?
**오직 ⑤에서 아무것도 못 읽었을 때(`needs_retake`)만.** 흐릿해도 텍스트가 조금이라도 읽히면
통과시켜 부분 결과를 보여주고, 숫자 불일치는 경고 배지로만 알린다 — 과도한 재촬영 요구를 피하려는 설계.
# ocr-test
