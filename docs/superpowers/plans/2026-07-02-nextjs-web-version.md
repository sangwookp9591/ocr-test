# Next.js 웹버전 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RN 앱(app/)과 동일 기능의 영수증 OCR 웹버전을 `web/`(Next.js, 포트 3005)에 만들고, dev.sh와 Docker(compose) 양쪽에서 한 방에 뜨게 한다.

**Architecture:** 단일 페이지 클라이언트 컴포넌트가 이미지를 canvas로 압축(1600px, q0.7) 후 `/receipt`로 POST. Next.js rewrite가 FastAPI(8000)로 프록시하므로 CORS·server.py 수정 없음. 스펙: `docs/superpowers/specs/2026-07-02-nextjs-web-version-design.md`

**Tech Stack:** Next.js 15 (App Router, JS), 일반 CSS, 의존성 next/react/react-dom 3개만.

## Global Constraints

- 웹 포트 **3005** 고정 (dev/start/Docker 모두)
- 압축 파라미터 **최대 1600px, JPEG q0.7** — 감열지 하한선, 줄이지 말 것
- 프로바이더 목록은 **app/App.js의 PROVIDERS 7개와 동일** (openai, gemini, gemma3, gemma4, vision, textract, docai)
- 서버 요청: `POST /receipt`, FormData 필드 `file`(이미지) + `provider`(키) — 둘 다 Form 필드
- TypeScript/UI 라이브러리/상태관리 라이브러리 금지, getUserMedia 커스텀 카메라 금지
- 커밋 메시지 끝에 `Claude-Session: https://claude.ai/code/session_01G2xtKoL79wUu2C3jskQbeA`

---

### Task 1: Next.js 스캐폴드 + rewrite 프록시

**Files:**
- Create: `web/package.json`, `web/next.config.mjs`, `web/app/layout.js`, `web/app/page.js`(임시), `web/app/globals.css`(임시), `web/.gitignore`

**Interfaces:**
- Produces: `npm run dev` → 3005 기동, `/receipt`·`/health`가 `RECEIPT_API`(기본 `http://localhost:8000`)로 프록시됨. 이후 태스크는 이 위에 쌓는다.

- [ ] **Step 1: 파일 작성**

`web/package.json`:
```json
{
  "name": "receipt-scanner-web",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3005",
    "build": "next build",
    "start": "next start -p 3005",
    "test": "node lib/compress.test.mjs"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

`web/next.config.mjs`:
```js
const API = process.env.RECEIPT_API || 'http://localhost:8000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: '/receipt', destination: `${API}/receipt` },
      { source: '/health', destination: `${API}/health` },
    ];
  },
};
export default nextConfig;
```

`web/app/layout.js`:
```js
import './globals.css';

export const metadata = { title: '영수증 스캔', description: '영수증 OCR 프로바이더 A/B 테스트' };

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
```

`web/app/page.js` (임시 — Task 3에서 교체):
```js
export default function Page() {
  return <main>receipt-scanner-web</main>;
}
```

`web/app/globals.css` (임시 — Task 4에서 교체):
```css
body { margin: 0; }
```

`web/.gitignore`:
```
node_modules/
.next/
```

- [ ] **Step 2: 설치 및 기동 확인**

```bash
cd web && npm install && npm run dev &
sleep 8
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3005      # 기대: 200
```

- [ ] **Step 3: 프록시 확인** (백엔드 8000이 떠있는 상태에서)

```bash
curl -s http://localhost:3005/health    # 기대: {"ok":true,"providers":[...]}
```
백엔드가 꺼져 있으면 502 — 그것도 프록시가 동작한다는 증거이므로 통과.

- [ ] **Step 4: dev 서버 종료 후 커밋**

```bash
git add web/ && git commit -m "feat(web): Next.js scaffold with /receipt proxy on port 3005"
```

---

### Task 2: lib/compress.js + 셀프체크

**Files:**
- Create: `web/lib/compress.js`, `web/lib/compress.test.mjs`

**Interfaces:**
- Produces: `fitWithin(w, h, max=1600) → {width, height}` (순수함수), `compressImage(file) → Promise<Blob>` (JPEG q0.7, 최대폭 1600). Task 3의 page.js가 `compressImage`를 import.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/lib/compress.test.mjs`:
```js
import assert from 'node:assert';
import { fitWithin } from './compress.js';

assert.deepStrictEqual(fitWithin(3200, 2400), { width: 1600, height: 1200 }); // 축소
assert.deepStrictEqual(fitWithin(800, 600), { width: 800, height: 600 });     // 확대 안 함
assert.deepStrictEqual(fitWithin(1600, 900), { width: 1600, height: 900 });   // 경계
console.log('compress selfcheck ok');
```

- [ ] **Step 2: 실패 확인**

```bash
cd web && npm test        # 기대: FAIL — Cannot find module './compress.js'
```

- [ ] **Step 3: 구현**

`web/lib/compress.js`:
```js
// 앱(ImageManipulator resize 1600 + q0.7)과 동일 파라미터 — 감열지 하한선, 줄이지 말 것.
export function fitWithin(w, h, max = 1600) {
  if (w <= max) return { width: w, height: h }; // ponytail: 업스케일 생략(앱은 항상 1600으로 리사이즈하지만 정보 이득 없음)
  return { width: max, height: Math.round(h * (max / w)) };
}

export async function compressImage(file, max = 1600, quality = 0.7) {
  const bmp = await createImageBitmap(file);
  const { width, height } = fitWithin(bmp.width, bmp.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bmp, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}
```

- [ ] **Step 4: 통과 확인**

```bash
cd web && npm test        # 기대: compress selfcheck ok
```

- [ ] **Step 5: 커밋**

```bash
git add web/lib/ && git commit -m "feat(web): canvas image compression (1600px, q0.7) with selfcheck"
```

---

### Task 3: page.js — 전체 UI (앱 5개 모드 재현)

**Files:**
- Modify: `web/app/page.js` (임시 내용 전체 교체)

**Interfaces:**
- Consumes: `compressImage(file)` (Task 2)
- Produces: 완성된 단일 페이지. 클래스명은 Task 4의 CSS 셀렉터와 1:1 대응 (아래 코드의 className 그대로).

- [ ] **Step 1: page.js 전체 교체**

```js
'use client';

import { useRef, useState } from 'react';
import { compressImage } from '../lib/compress';

// 서버 PROVIDERS 키와 일치해야 함 (app/App.js와 동일)
const PROVIDERS = [
  { key: 'openai', label: 'OpenAI' },
  { key: 'gemini', label: 'Gemini' },
  { key: 'gemma3', label: 'Gemma4 26B' },
  { key: 'gemma4', label: 'Gemma4 31B' },
  { key: 'vision', label: 'Vision' },
  { key: 'textract', label: 'Textract' },
  { key: 'docai', label: 'Doc AI' },
];
const labelOf = (k) => PROVIDERS.find((p) => p.key === k)?.label || k;
const fmt = (n) => (n != null ? n.toLocaleString() : '—');

export default function Page() {
  const [mode, setMode] = useState('idle'); // idle | analyzing | success | result | problem
  const [image, setImage] = useState(null);   // objectURL
  const [result, setResult] = useState(null);
  const [problem, setProblem] = useState('');
  const [provider, setProvider] = useState('openai');
  const [history, setHistory] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const titleOf = (json) => {
    const r = json.receipts?.[0];
    if (!r) return '결과 없음';
    if (r.merchant) return r.total != null ? `${r.merchant} · ${r.total.toLocaleString()}원` : r.merchant;
    if (r.total != null) return `${r.total.toLocaleString()}원`;
    return r.raw_text ? '텍스트' : '결과 없음';
  };
  const addHistory = (partial) => setHistory((h) => [{
    id: Date.now(),
    time: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
    providerLabel: labelOf(provider),
    ...partial,
  }, ...h].slice(0, 50));

  async function submit(file) {
    if (!file || !file.type.startsWith('image/')) return;
    setProblem('');
    const blob = await compressImage(file);
    setImage(URL.createObjectURL(blob));
    setMode('analyzing');
    try {
      const form = new FormData();
      form.append('file', blob, 'receipt.jpg');
      form.append('provider', provider);
      const res = await fetch('/receipt', { method: 'POST', body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `서버 오류 (HTTP ${res.status})`);
      setResult(json);
      addHistory({
        model: json.model, ms: json.latency_ms, cost: json.cost_usd,
        tokens: json.input_tokens != null ? json.input_tokens + (json.output_tokens ?? 0) : null,
        status: json.needs_retake ? 'retake' : 'ok',
        title: json.needs_retake ? '재촬영 필요' : titleOf(json),
      });
      if (json.needs_retake) {
        setProblem('흐리거나 상호·날짜·총액이 안 보입니다. 다시 촬영해주세요.');
        setMode('problem');
      } else {
        setMode('success');
        setTimeout(() => setMode('result'), 1250);
      }
    } catch (e) {
      addHistory({ model: null, ms: null, status: 'fail', title: (e.message ?? String(e)).split('\n')[0] });
      setProblem(`서버에 연결하지 못했습니다.\n${e.message ?? e}`);
      setMode('problem');
    }
  }

  const busy = mode === 'analyzing' || mode === 'success';
  const totalsMatch = result?.receipts?.some((r) => r.total_matches_items);

  return (
    <main className="root">
      <header className="header">
        <div className="kicker">RECEIPT AI</div>
        <h1 className="title">영수증 스캔</h1>
        <div className="sub">업로드 · 품질 검사 · 즉시 인식</div>
      </header>

      {!busy && (
        <div className="segment">
          {PROVIDERS.map((p) => (
            <button key={p.key} onClick={() => setProvider(p.key)}
              className={`segItem${provider === p.key ? ' segItemOn' : ''}`}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="body">
        {mode === 'result' && result && (
          <>
            <div className="metricBar">
              <div className="metric">
                <div className="metricLabel accent">{(labelOf(result.provider) || '엔진').toUpperCase()}</div>
                <div className="metricValue">{result.model || result.provider}</div>
              </div>
              <div className="metric">
                <div className="metricLabel">응답속도</div>
                <div className="metricValue">{result.latency_ms != null ? `${result.latency_ms}ms` : '—'}</div>
              </div>
              <div className="metric">
                <div className="metricLabel">합계검증</div>
                <div className={`metricValue ${totalsMatch ? 'ok' : 'warn'}`}>{totalsMatch ? '일치' : '확인'}</div>
              </div>
            </div>
            <div className="costLine">
              <span>
                {result.input_tokens != null
                  ? `토큰 입력 ${fmt(result.input_tokens)} · 출력 ${fmt(result.output_tokens)}`
                  : '페이지 과금 (토큰 없음)'}
              </span>
              <span className="costUsd">
                {result.cost_usd != null ? `≈ $${result.cost_usd.toFixed(4)} · ₩${fmt(result.cost_krw)}` : '—'}
              </span>
            </div>
          </>
        )}

        {(mode === 'idle' || mode === 'problem') && (
          <div
            className={`frame${dragOver ? ' frameDrag' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); submit(e.dataTransfer.files?.[0]); }}
          >
            <div className="frameHint">
              영수증 이미지를 클릭해 선택하거나<br />여기로 드래그하세요<br />
              <span className="frameHintSub">(모바일에선 카메라가 열립니다)</span>
            </div>
          </div>
        )}

        {busy && image && (
          <div className="frame">
            <img src={image} className="shot" alt="영수증" />
            {mode === 'analyzing' && <div className="analyzingPill">분석 중…</div>}
            {mode === 'success' && (
              <div className="successOverlay">
                <div className="successCircle">✓</div>
                <div className="successText">인식 완료</div>
              </div>
            )}
          </div>
        )}

        {mode === 'result' && result?.receipts?.map((r, i) => {
          const isText = !r.merchant && r.total == null && !r.items?.length;
          return (
            <div className="card" key={i}>
              {isText ? (
                <>
                  <div className="cardTop">
                    <div className="merchant">인식된 텍스트</div>
                    <span className="badge badgeOk">TEXT</span>
                  </div>
                  <pre className="rawText">{r.raw_text || '—'}</pre>
                </>
              ) : (
                <>
                  <div className="cardTop">
                    <div>
                      <div className="merchant">{r.merchant || '상호 미상'}</div>
                      <div className="date">
                        {r.date || '날짜 미상'}
                        {r.fields_found != null && `  ·  필드 ${r.fields_found}/${r.fields_total}`}
                      </div>
                    </div>
                    <span className={`badge ${r.total_matches_items ? 'badgeOk' : 'badgeWarn'}`}>
                      {r.total_matches_items ? '합계 일치' : '합계 확인'}
                    </span>
                  </div>
                  <div className="totalRow">
                    <span className="totalLabel">총액</span>
                    <span className="totalValue">{fmt(r.total)} <span className="currency">{r.currency || 'KRW'}</span></span>
                  </div>
                  {r.items?.length > 0 ? (
                    <table className="items">
                      <thead>
                        <tr><th>품목 {r.items.length}</th><th>수량</th><th>금액</th></tr>
                      </thead>
                      <tbody>
                        {r.items.map((it, j) => (
                          <tr key={j}>
                            <td>{it.name || '—'}</td>
                            <td>{it.quantity ?? '—'}</td>
                            <td>{fmt(it.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : r.raw_text ? (
                    <pre className="rawText">{r.raw_text}</pre>
                  ) : null}
                </>
              )}
            </div>
          );
        })}

        {mode === 'problem' && (
          <div className="card problemCard">
            <div className="problemIcon">⚠</div>
            <div className="problemText">{problem}</div>
          </div>
        )}

        {history.length > 0 && (
          <div className="histWrap">
            <div className="histHead">인식 이력 · {history.length}</div>
            {history.map((h) => (
              <div className="histRow" key={h.id}>
                <span className={`histDot dot-${h.status}`} />
                <div className="histMain">
                  <div className="histModel">{h.providerLabel}{h.model ? ` · ${h.model}` : ''}</div>
                  <div className="histSub">{h.time} · {h.title}</div>
                </div>
                <div className="histRight">
                  <div className="histMs">{h.ms != null ? `${(h.ms / 1000).toFixed(1)}s` : '—'}</div>
                  <div className="histCost">{h.cost != null ? `$${h.cost.toFixed(4)}` : h.tokens ? `${fmt(h.tokens)} tok` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!busy && (
        <footer className="footer">
          <button className="btn" onClick={() => fileRef.current?.click()}>
            {mode === 'result' ? '다음 영수증 스캔' : mode === 'problem' ? '다시 선택' : '영수증 스캔'}
          </button>
        </footer>
      )}

      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { submit(e.target.files?.[0]); e.target.value = ''; }} />
    </main>
  );
}
```

- [ ] **Step 2: 동작 확인** (백엔드 8000 기동 상태)

```bash
cd web && npm run dev &
sleep 8
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3005     # 기대: 200
```
브라우저 `http://localhost:3005`에서: 영수증 이미지 업로드 → "분석 중…" → 결과 카드/메트릭/이력 표시.
서버를 끄고 업로드 → "서버에 연결하지 못했습니다" 문제 카드.

- [ ] **Step 3: 커밋**

```bash
git add web/app/page.js && git commit -m "feat(web): full receipt scan UI (5 modes, providers, history)"
```

---

### Task 4: globals.css — 앱 팔레트 이식

**Files:**
- Modify: `web/app/globals.css` (임시 내용 전체 교체)

**Interfaces:**
- Consumes: Task 3의 className들 (root/header/segment/frame/card/histWrap/footer 등 — 아래 셀렉터와 1:1)

- [ ] **Step 1: globals.css 전체 교체**

```css
/* 앱(App.js) 팔레트 이식 */
:root {
  --bg: #F6F5F1; --surface: #FFF; --ink: #17130E; --muted: #8C867B;
  --line: #EBE8E1; --accent: #0E9F6E; --accent-deep: #0B8457;
  --accent-soft: #E6F6EF; --warn: #E8590C; --warn-soft: #FCEEE3;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: linear-gradient(#EFEEE8, var(--bg)); color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
}
.root { max-width: 560px; margin: 0 auto; min-height: 100vh; display: flex; flex-direction: column; padding: 24px; gap: 14px; }
.header .kicker { font-size: 12px; font-weight: 700; letter-spacing: 2px; color: var(--accent-deep); margin-bottom: 6px; }
.header .title { font-size: 34px; font-weight: 800; letter-spacing: -0.8px; margin: 0; }
.header .sub { font-size: 14px; color: var(--muted); margin-top: 4px; }

.segment { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.segItem {
  border: 1px solid var(--line); background: var(--surface); color: var(--muted);
  border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 600;
  white-space: nowrap; cursor: pointer;
}
.segItemOn { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-deep); }

.body { display: flex; flex-direction: column; gap: 14px; flex: 1; }

.frame {
  position: relative; border: 2px dashed var(--line); border-radius: 20px;
  background: var(--surface); min-height: 300px; display: flex; align-items: center;
  justify-content: center; text-align: center; cursor: pointer; overflow: hidden;
}
.frameDrag { border-color: var(--accent); background: var(--accent-soft); }
.frameHint { color: var(--muted); font-size: 15px; line-height: 1.7; }
.frameHintSub { font-size: 12px; }
.shot { width: 100%; height: 300px; object-fit: cover; display: block; }
.analyzingPill {
  position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);
  background: rgba(23,19,14,0.8); color: #fff; border-radius: 999px;
  padding: 8px 16px; font-size: 13px;
}
.successOverlay {
  position: absolute; inset: 0; background: rgba(246,245,241,0.94);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
}
.successCircle {
  width: 64px; height: 64px; border-radius: 50%; background: var(--accent);
  color: #fff; font-size: 30px; display: flex; align-items: center; justify-content: center;
  animation: pop 0.35s cubic-bezier(0.2, 1.4, 0.4, 1);
}
@keyframes pop { from { transform: scale(0.3); } to { transform: scale(1); } }
.successText { font-weight: 700; color: var(--accent-deep); }

.metricBar {
  display: flex; background: var(--surface); border: 1px solid var(--line);
  border-radius: 16px; padding: 14px 0;
}
.metric { flex: 1; text-align: center; border-right: 1px solid var(--line); padding: 0 8px; min-width: 0; }
.metric:last-child { border-right: 0; }
.metricLabel { font-size: 11px; color: var(--muted); font-weight: 700; margin-bottom: 4px; }
.metricLabel.accent { color: var(--accent-deep); }
.metricValue { font-size: 14px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.metricValue.ok { color: var(--accent-deep); }
.metricValue.warn { color: var(--warn); }
.costLine { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); padding: 0 4px; }
.costUsd { font-weight: 600; }

.card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 18px; }
.cardTop { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.merchant { font-size: 18px; font-weight: 800; }
.date { font-size: 13px; color: var(--muted); margin-top: 3px; }
.badge { border-radius: 999px; padding: 5px 10px; font-size: 12px; font-weight: 700; flex-shrink: 0; }
.badgeOk { background: var(--accent-soft); color: var(--accent-deep); }
.badgeWarn { background: var(--warn-soft); color: var(--warn); }
.totalRow { display: flex; justify-content: space-between; align-items: baseline; margin-top: 14px; }
.totalLabel { font-size: 13px; color: var(--muted); }
.totalValue { font-size: 24px; font-weight: 800; }
.currency { font-size: 13px; color: var(--muted); font-weight: 600; }
.items { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
.items th { text-align: left; color: var(--muted); font-size: 12px; font-weight: 700; padding: 6px 4px; border-bottom: 1px solid var(--line); }
.items th:nth-child(2), .items td:nth-child(2) { text-align: center; width: 52px; }
.items th:last-child, .items td:last-child { text-align: right; }
.items td { padding: 8px 4px; border-bottom: 1px solid var(--line); }
.items tr:last-child td { border-bottom: 0; }
.rawText { white-space: pre-wrap; font-size: 13px; color: var(--ink); margin: 10px 0 0; font-family: inherit; }

.problemCard { background: var(--warn-soft); border-color: var(--warn); text-align: center; animation: shake 0.35s; }
@keyframes shake { 0% { transform: translateX(-8px); } 25% { transform: translateX(7px); } 50% { transform: translateX(-5px); } 75% { transform: translateX(4px); } 100% { transform: translateX(0); } }
.problemIcon { font-size: 28px; }
.problemText { white-space: pre-wrap; font-size: 14px; margin-top: 6px; }

.histWrap { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 14px 18px; }
.histHead { font-size: 12px; font-weight: 700; color: var(--muted); margin-bottom: 8px; }
.histRow { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); }
.histRow:first-of-type { border-top: 0; }
.histDot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot-ok { background: var(--accent); }
.dot-retake { background: var(--warn); }
.dot-fail { background: #C92A2A; }
.histMain { flex: 1; min-width: 0; }
.histModel { font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.histSub { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.histRight { text-align: right; }
.histMs { font-size: 13px; font-weight: 700; }
.histCost { font-size: 11px; color: var(--muted); }

.footer { position: sticky; bottom: 16px; }
.btn {
  width: 100%; border: 0; border-radius: 16px; padding: 16px;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  color: #fff; font-size: 16px; font-weight: 800; cursor: pointer;
  box-shadow: 0 8px 20px rgba(14,159,110,0.35);
}
.btn:active { transform: scale(0.97); }
```

- [ ] **Step 2: 육안 확인**

`npm run dev` 상태에서 브라우저 새로고침 → 앱과 같은 크림/그린 팔레트, 세그먼트 pill, 카드 스타일 확인. 반응형: 창을 375px로 줄여도 깨지지 않아야 함.

- [ ] **Step 3: 커밋**

```bash
git add web/app/globals.css && git commit -m "style(web): port app palette and card styles"
```

---

### Task 5: dev.sh에 웹 기동 추가

**Files:**
- Modify: `dev.sh` (백엔드 시작 블록과 expo 실행 블록 사이)

**Interfaces:**
- Produces: `bash dev.sh` 한 번에 백엔드(8000) + 웹(3005) + 앱 빌드 모두 기동.

- [ ] **Step 1: dev.sh 수정**

포트 정리 줄에 3005 추가, 백엔드 시작 직후에 웹 블록 삽입:

```bash
# (기존) lsof -ti:8000 ... / lsof -ti:8081 ... 아래에 추가
lsof -ti:3005 2>/dev/null | xargs kill -9 2>/dev/null

# (백엔드 시작 + sleep 2 다음에 추가)
# 3) 웹 (Next.js dev, 3005)
[ -d web/node_modules ] || (cd web && npm install)
(cd web && nohup npm run dev > /tmp/ocr-web.log 2>&1 &)
echo "▶ 웹: http://$IP:3005 (로그: /tmp/ocr-web.log)"
```

기존 "3) 실기기 재빌드" 주석 번호는 4)로 갱신.

- [ ] **Step 2: 확인**

```bash
bash dev.sh    # 앱 빌드 시작까지 확인 후 Ctrl+C 가능
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3005   # 기대: 200
curl -s http://localhost:8000/health                              # 기대: {"ok":true,...}
```

- [ ] **Step 3: 커밋**

```bash
git add dev.sh && git commit -m "feat: start web (3005) alongside backend and app build in dev.sh"
```

---

### Task 6: Docker — web/Dockerfile + docker-compose.yml

**Files:**
- Create: `web/Dockerfile`, `web/.dockerignore`, `docker-compose.yml`
- Modify: `docker-run.sh`

**Interfaces:**
- Produces: `bash docker-run.sh` → api(8000) + web(3005) 컨테이너 동시 기동. `bash docker-run.sh api` → 백엔드만.

- [ ] **Step 1: 파일 작성**

`web/Dockerfile`:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# rewrites는 빌드 시점에 env를 읽음 — compose 내부 네트워크의 api 서비스로 고정
ENV RECEIPT_API=http://api:8000
RUN npm run build
EXPOSE 3005
CMD ["npm", "run", "start"]
```

`web/.dockerignore`:
```
node_modules
.next
```

`docker-compose.yml` (루트):
```yaml
services:
  api:
    build: .
    ports: ["8000:8000"]
    environment:
      - OPENAI_API_KEY
      - GOOGLE_API_KEY
    env_file:
      - path: .env.local
        required: false
  web:
    build: ./web
    ports: ["3005:3005"]
    depends_on: [api]
```

`docker-run.sh` 전체 교체:
```bash
#!/bin/bash
# Docker로 전체(api+web) 또는 일부만 실행. 키는 .openai_key / .google_key / .env.local 에서 자동 주입.
#   bash docker-run.sh          # api(8000) + web(3005)
#   bash docker-run.sh api      # 백엔드만
set -e
cd "$(dirname "$0")"
[ -s .openai_key ] && export OPENAI_API_KEY="$(tr -d '[:space:]' < .openai_key)"
[ -s .google_key ] && export GOOGLE_API_KEY="$(tr -d '[:space:]' < .google_key)"
IP=$(ipconfig getifaddr en0 2>/dev/null || echo localhost)
echo "▶ api http://$IP:8000 · web http://$IP:3005  (Ctrl+C로 종료)"
exec docker compose up --build "$@"
```

- [ ] **Step 2: 확인**

```bash
bash docker-run.sh &
sleep 60   # 첫 빌드는 오래 걸림
curl -s http://localhost:8000/health                               # 기대: {"ok":true,...}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3005     # 기대: 200
curl -s http://localhost:3005/health                               # 기대: api로 프록시된 {"ok":true,...}
docker compose down
```

- [ ] **Step 3: 커밋**

```bash
git add web/Dockerfile web/.dockerignore docker-compose.yml docker-run.sh
git commit -m "feat: docker compose for api(8000) + web(3005)"
```

---

### Task 7: README 웹버전 섹션

**Files:**
- Modify: `README.md` — "빠른 시작 (dev.sh)" 섹션 갱신 + "3. 앱 빌드" 다음에 웹 섹션 추가

**Interfaces:** 없음 (문서)

- [ ] **Step 1: 빠른 시작 섹션의 흐름 설명 갱신**

"8000/8081 포트" → "8000/8081/3005 포트", "서버 재시작 →" 뒤에 "웹(3005) 기동 →" 추가.

- [ ] **Step 2: 웹 섹션 추가** ("3. 앱 빌드" 섹션 뒤)

```markdown
## 3.5 웹버전 (Next.js, 포트 3005)

앱과 동일한 A/B 테스트 하니스의 브라우저판. 데스크톱은 업로드/드래그&드롭, 모바일 브라우저는 카메라.

```bash
cd web && npm install && npm run dev    # http://localhost:3005
```

- 백엔드 연결은 Next rewrite 프록시(`/receipt` → `RECEIPT_API`, 기본 `localhost:8000`) — CORS·IP 설정 불필요.
- 폰에서 쓸 때: `http://<PC-LAN-IP>:3005` 하나만 열면 됨.
- Docker로 전체 실행: `bash docker-run.sh` (api 8000 + web 3005, compose).
```

- [ ] **Step 3: 커밋**

```bash
git add README.md && git commit -m "docs: web version section in README"
```
