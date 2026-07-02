'use client';

import { useRef, useState } from 'react';
import { compressImage } from '../lib/compress';
import { scan as scanDoc } from '../lib/snapdoc/index.js';

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
  const successTimer = useRef(null);

  const titleOf = (json) => {
    const r = json.receipts?.[0];
    if (!r) return '결과 없음';
    if (r.merchant) return r.total != null ? `${r.merchant} · ${fmt(r.total)}원` : r.merchant;
    if (r.total != null) return `${fmt(r.total)}원`;
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
    clearTimeout(successTimer.current); // 성공 오버레이 중 재스캔 시 이전 타이머가 result로 튀는 것 방지
    setProblem('');
    // snapdoc: 문서 감지되면 보정 캔버스, 아니면 원본 — 압축/인코딩(1600px, q0.7)은 compressImage 한 곳
    const scanned = await scanDoc(file).catch(() => null);
    const blob = await compressImage(scanned?.canvas ?? file);
    setImage((prev) => {
      if (prev) URL.revokeObjectURL(prev); // 이전 스캔 blob 메모리 해제
      return URL.createObjectURL(blob);
    });
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
        successTimer.current = setTimeout(() => setMode('result'), 1250);
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
