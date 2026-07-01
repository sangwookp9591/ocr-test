"""
영수증 VLM 추출 서버 — ocr_test.extract()를 그대로 감싼 FastAPI 엔드포인트 하나.
앱(RN)이 압축한 이미지를 POST하면 JSON + 합계검증 + 품질 게이트(needs_retake)를 돌려준다.
프로바이더 교체는 ocr_test와 동일하게 env로: OPENAI_MODEL / OPENAI_DETAIL (향후 Gemini/Qwen도 여기만 갈아끼움).

실행:
  export OPENAI_API_KEY=sk-...
  .venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000
  python3 server.py --selfcheck   # 네트워크/키 없이 품질 게이트 로직만 점검
"""
import os
import sys
import tempfile

from ocr_test import extract, totals_match, cost_of  # 검증된 추출 로직 재사용

USD_KRW = 1380  # 예상 비용 원화 환산(대략)


def summarize(data):
    """앱이 바로 쓰는 평면 JSON + 품질 게이트.
    needs_retake = 읽을 수 있는 영수증이 하나도 없음(총액/날짜/상호 중 필수 결측)."""
    out = []
    for r in data.get("receipts", []):
        items = r.get("items", [])
        total = r.get("total")
        raw_text = (r.get("raw_text") or "").strip()
        # 필드 완성도(정확도 프록시): 상호·날짜·총액·품목 중 몇 개나 뽑았나 (0~4).
        fields_found = sum([bool(r.get("store")), bool(r.get("date")),
                            total is not None, len(items) > 0])
        out.append({
            "merchant": r.get("store"),
            "date": r.get("date"),
            "total": total,
            "currency": "KRW",
            "items": items,
            "raw_text": raw_text,
            "total_matches_items": totals_match(r),  # 규칙은 ocr_test.totals_match 한 곳
            "fields_found": fields_found,
            "fields_total": 4,
        })
    # 품질 게이트(범용): 뭐라도 읽히면 통과(총액·텍스트·품목·상호·날짜 중 하나).
    # Gemma처럼 스키마 미강제라 total/raw_text가 비어도 품목/상호를 뽑으면 재촬영 오탐 방지.
    readable = any(r["total"] is not None or r["raw_text"] or r["items"]
                   or r["merchant"] or r["date"] for r in out)
    return {"receipts": out, "needs_retake": not readable}


# ---- FastAPI (uvicorn 실행 시에만 import; --selfcheck는 키/네트워크 불필요) ----
def build_app():
    import time

    from fastapi import FastAPI, UploadFile, File, Form
    from fastapi.concurrency import run_in_threadpool
    from fastapi.responses import JSONResponse

    from ocr_test import PROVIDERS, DEFAULT_PROVIDER

    app = FastAPI(title="Receipt OCR")

    @app.get("/health")
    def health():
        return {"ok": True, "providers": list(PROVIDERS)}

    @app.post("/receipt")
    async def receipt(file: UploadFile = File(...), provider: str = Form(DEFAULT_PROVIDER)):
        if provider not in PROVIDERS:
            return JSONResponse(status_code=400, content={"error": f"unknown provider: {provider}"})
        ext = os.path.splitext(file.filename or "")[1] or ".jpg"
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(await file.read())
            path = tmp.name
        t0 = time.perf_counter()
        try:
            # extract는 수초 걸리는 동기 네트워크 호출 → 스레드풀로 offload해 이벤트루프 안 막음
            data = await run_in_threadpool(extract, path, provider)
        except Exception as e:
            return JSONResponse(status_code=502, content={
                "error": f"{provider} 추출 실패: {e}", "provider": provider})
        finally:
            os.unlink(path)
        usage = data.get("_usage")
        cost = cost_of(provider, usage)
        res = summarize(data)
        res["provider"] = provider
        res["model"] = PROVIDERS[provider]["model"]
        res["latency_ms"] = int((time.perf_counter() - t0) * 1000)
        res["input_tokens"] = usage["input_tokens"] if usage else None
        res["output_tokens"] = usage["output_tokens"] if usage else None
        res["cost_usd"] = cost
        res["cost_krw"] = round(cost * USD_KRW) if cost is not None else None
        return res

    return app


def selfcheck():
    # 게이트 통과: 총액/날짜/상호 다 있음
    ok = summarize({"receipts": [{"store": "CU", "date": "2026-07-01",
                                  "items": [{"amount": 5300}], "total": 5300}]})
    assert ok["needs_retake"] is False
    assert ok["receipts"][0]["merchant"] == "CU"
    assert ok["receipts"][0]["total_matches_items"] is True
    assert ok["receipts"][0]["fields_found"] == 4  # 상호+날짜+총액+품목
    # 통과: 총액 없어도 텍스트만 읽히면 OK (범용 텍스트 인식)
    txt = summarize({"receipts": [{"store": None, "date": None, "items": [],
                                   "total": None, "raw_text": "아무 텍스트나"}]})
    assert txt["needs_retake"] is False
    assert txt["receipts"][0]["raw_text"] == "아무 텍스트나"
    # 통과: total/raw_text 없어도 상호·품목이 있으면 OK (Gemma 재촬영 오탐 방지)
    partial = summarize({"receipts": [{"store": "CU", "date": "2026-07-01",
                                       "items": [{"amount": 5300}], "total": None, "raw_text": ""}]})
    assert partial["needs_retake"] is False
    # 재촬영: 완전히 빈 결과만
    bad = summarize({"receipts": [{"store": None, "date": None, "items": [],
                                   "total": None, "raw_text": ""}]})
    assert bad["needs_retake"] is True
    # 재촬영: 영수증 0장
    assert summarize({"receipts": []})["needs_retake"] is True
    # 합계 불일치 감지
    mm = summarize({"receipts": [{"store": "CU", "date": "2026-07-01",
                                  "items": [{"amount": 5300}], "total": 9999}]})
    assert mm["receipts"][0]["total_matches_items"] is False
    print("server selfcheck OK")


app = None
if __name__ == "__main__":
    if "--selfcheck" in sys.argv:
        selfcheck()
    else:
        import uvicorn
        app = build_app()
        uvicorn.run(app, host="0.0.0.0", port=8000)
else:
    # uvicorn server:app 로 실행되는 경로
    app = build_app()
