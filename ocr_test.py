"""
약국(보령약국) 영수증 인식 MVP 테스트.
이미지 1장 → OpenAI Vision(detail: low) → Structured Output(JSON Schema) → 상품 목록 + 합계검증.
한 사진에 영수증이 여러 장이면 각각 분리해서 뽑는다.
DB/매칭/배송 없음 — "인식이 되긴 하나 + 숫자 정확한가"만 본다.

실행:
  export OPENAI_API_KEY=sk-...          # 본인 셸에서 직접
  python3 ocr_test.py receipt.jpg
  python3 ocr_test.py --selfcheck       # 네트워크/키 없이 스키마·파싱·검증 로직만 점검
"""
import base64
import json
import os
import re
import sys

DETAIL = os.getenv("OPENAI_DETAIL", "high")   # 감열지 작은 글씨는 low로 안 읽힘 → high 기본. 비용 낮추려면 OPENAI_DETAIL=low

# Google AI는 OpenAI 호환 엔드포인트를 제공 → OpenAI SDK를 base_url만 바꿔 재사용.
GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/"

# 앱에서 세그먼트 버튼으로 고르는 프로바이더들. 모델명은 env로 덮어쓸 수 있음.
# kind=vlm: 이미지→LLM→JSON (schema=True면 json_schema 강제, Gemma는 불안정 → False, 실패 시 raw_text 폴백).
# kind=textract/docai: 전용 영수증 파서. 이미지→OCR+좌표→필드추출까지 클라우드가 처리 → 우리는 스키마로 매핑만.
PROVIDERS = {
    "openai":   {"kind": "vlm", "base_url": None,        "key_env": "OPENAI_API_KEY", "model": os.getenv("OPENAI_MODEL", "gpt-5.5"),          "schema": True},
    "gemini":   {"kind": "vlm", "base_url": GOOGLE_BASE, "key_env": "GOOGLE_API_KEY", "model": os.getenv("GEMINI_MODEL", "gemini-2.5-flash"), "schema": True},
    "gemma3":   {"kind": "vlm", "base_url": GOOGLE_BASE, "key_env": "GOOGLE_API_KEY", "model": os.getenv("GEMMA3_MODEL", "gemma-4-26b-a4b-it"), "schema": False},
    "gemma4":   {"kind": "vlm", "base_url": GOOGLE_BASE, "key_env": "GOOGLE_API_KEY", "model": os.getenv("GEMMA4_MODEL", "gemma-4-31b-it"),    "schema": False},
    # 전용 파서(VLM보다 저렴할 수 있음). 클라우드 자격증명 필요 — 미설정 시 호출 실패.
    "vision":   {"kind": "vision",   "model": "Cloud Vision OCR"},   # 한국어 등 다국어 OCR(원문 텍스트)
    "textract": {"kind": "textract", "model": "AnalyzeExpense"},     # 영문/라틴 전용
    "docai":    {"kind": "docai",    "model": "Document AI OCR"},
}
DEFAULT_PROVIDER = os.getenv("OCR_PROVIDER", "openai")


def _num(s):
    """'1,200원' / '$3.50' 같은 텍스트에서 숫자만. 정수면 int, 소수면 float, 못 뽑으면 None."""
    if s is None:
        return None
    m = re.sub(r"[^\d.\-]", "", str(s))
    if m in ("", "-", ".", "-."):
        return None
    try:
        return float(m) if "." in m else int(m)
    except ValueError:
        return None


def _receipt(store=None, date=None, items=None, total=None, raw_text=""):
    """모든 프로바이더가 공통으로 반환하는 receipt dict 한 곳에서 생성 (스키마와 동일 형태)."""
    return {"store": store, "date": date, "items": items or [], "total": total, "raw_text": raw_text}


def _mime(path):
    """파일 확장자 → image 서브타입('jpeg'/'png'...). data URL은 f'image/{_mime(p)}'로 조립."""
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    return "jpeg" if ext in ("jpg", "jpeg", "") else ext


def totals_match(r):
    """합계검증: 항목 금액 합 == 인쇄 총액. 숫자 인식 신뢰도 신호(이름 오류는 못 잡음)."""
    s = sum((it.get("amount") or 0) for it in r.get("items", []))
    return r.get("total") is not None and s == r["total"]


# 프로바이더별 요금(USD). VLM=100만 토큰당(입력/출력), 전용 파서=호출(페이지)당.
# 대략치 — 최신 공식 요율로 조정. Gemma는 AI Studio에선 무료지만 프로덕션(MaaS) 환산용 참고 요율.
PRICES = {
    "openai":   {"in": 1.25, "out": 10.0},   # gpt-5.5 (요율 확인 필요)
    "gemini":   {"in": 0.15, "out": 0.60},    # Gemini 2.5 Flash (이미지=텍스트 동일요율)
    "gemma3":   {"in": 0.10, "out": 0.40},    # Gemma4 26B A4B (MaaS 중간값)
    "gemma4":   {"in": 0.13, "out": 0.38},    # Gemma4 31B (MaaS)
    "vision":   {"per_call": 0.0015},         # Cloud Vision DOCUMENT_TEXT_DETECTION ≈ $1.5/1000장
    "textract": {"per_call": 0.01},           # AnalyzeExpense/page (요율 확인 필요)
    "docai":    {"per_call": 0.03},           # Doc AI Expense/page (요율 확인 필요)
}


def cost_of(provider, usage):
    """건당 예상 비용(USD). usage={'input_tokens','output_tokens'} 또는 None(전용 파서)."""
    p = PRICES.get(provider, {})
    if "per_call" in p:
        return p["per_call"]
    if not usage:
        return None
    return round(usage["input_tokens"] / 1e6 * p.get("in", 0)
                 + usage["output_tokens"] / 1e6 * p.get("out", 0), 6)


RECEIPT = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "store": {"type": ["string", "null"]},
        "date": {"type": ["string", "null"]},  # YYYY-MM-DD
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"},
                    "quantity": {"type": ["integer", "null"]},
                    "unit_price": {"type": ["number", "null"]},
                    "amount": {"type": ["number", "null"]},
                },
                "required": ["name", "quantity", "unit_price", "amount"],
            },
        },
        "total": {"type": ["number", "null"]},
        "raw_text": {"type": ["string", "null"]},  # 영수증/이미지에 보이는 모든 텍스트 원문
    },
    "required": ["store", "date", "items", "total", "raw_text"],
}

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"receipts": {"type": "array", "items": RECEIPT}},
    "required": ["receipts"],
}

PROMPT = (
    "이 이미지는 영수증 또는 텍스트가 담긴 사진이다. 종류를 가리지 않는다"
    "(편의점·식당·카페·마트·병원·약국·주유소·온라인 주문서 등 모든 영수증, 또는 일반 문서/텍스트). "
    "이미지에 영수증이 여러 장이면 각 영수증을 receipts 배열의 개별 항목으로 분리한다. "
    "각 영수증에서 상호명(store), 날짜(date, YYYY-MM-DD), 총액(total)을 채우고, "
    "모든 상품/항목 라인아이템을 빠짐없이 추출한다: 이름(name), 수량(quantity), 단가(unit_price), 금액(amount). "
    "할인/포인트/봉투값 등 상품이 아닌 줄은 items에서 제외한다. "
    "그리고 해당 영수증/영역에 보이는 모든 텍스트를 원문 그대로 raw_text에 담는다. "
    "영수증이 아니거나 항목을 나눌 수 없는 경우에도, 이미지의 모든 텍스트를 receipts 한 항목의 raw_text에 담고 "
    "나머지 필드(store/date/total/items)는 알 수 있으면 채우고 모르면 null/빈 배열로 둔다. "
    "읽을 수 없는 값은 null."
)


def _strip_thought(text):
    """Gemma Thinking 모드의 <thought>…</thought> 제거. 닫힌 블록은 통째로 제거하고,
    (토큰 부족 등으로) 안 닫힌 경우엔 뒤에 JSON('{')이 있으면 그 앞까지 버리고, 없으면 태그만 제거."""
    text = text or ""
    text = re.sub(r"<(thought|thinking)>.*?</\1>", "", text, flags=re.DOTALL)
    m = re.search(r"<(thought|thinking)>", text)
    if m:
        brace = text.find("{", m.end())
        text = (text[:m.start()] + text[brace:]) if brace != -1 else re.sub(r"</?(thought|thinking)>", "", text)
    return text.strip()


def _parse_json(text):
    """모델이 ```json 펜스나 잡텍스트를 섞어도 최대한 파싱. 실패 시 raise."""
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if "\n" in text else text
    # 앞뒤 잡텍스트 제거: 첫 { ~ 마지막 }
    l, r = text.find("{"), text.rfind("}")
    if l != -1 and r != -1:
        text = text[l:r + 1]
    return json.loads(text)


def extract(image_path, provider=DEFAULT_PROVIDER):
    """프로바이더 종류에 따라 분기. 모두 {"receipts":[{store,date,items,total,raw_text}]} 반환."""
    cfg = PROVIDERS[provider]
    kind = cfg.get("kind", "vlm")
    if kind == "vlm":
        return _extract_vlm(image_path, cfg)
    if kind == "vision":
        return _extract_vision(image_path)
    if kind == "textract":
        return _extract_textract(image_path)
    if kind == "docai":
        return _extract_docai(image_path)
    raise ValueError(f"unknown provider kind: {kind}")


def _extract_vlm(image_path, cfg):
    from openai import OpenAI

    key = os.environ[cfg["key_env"]]
    client = OpenAI(api_key=key, base_url=cfg["base_url"]) if cfg["base_url"] else OpenAI(api_key=key)

    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    mime = _mime(image_path)

    prompt = PROMPT if cfg["schema"] else PROMPT + " 반드시 JSON만 출력하고 다른 말은 하지 마라."
    kwargs = {
        "model": cfg["model"],
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url",
                 "image_url": {"url": f"data:image/{mime};base64,{b64}", "detail": DETAIL}},
            ],
        }],
    }
    if cfg["schema"]:
        kwargs["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "receipts", "strict": True, "schema": SCHEMA},
        }
    else:
        # Gemma는 Thinking 모드(끌 수 없음)라 <thought> 추론 후에 JSON을 냄 → 잘리지 않게 토큰 넉넉히.
        kwargs["max_tokens"] = 4096
    resp = client.chat.completions.create(**kwargs)
    content = resp.choices[0].message.content
    u = getattr(resp, "usage", None)
    usage = {"input_tokens": u.prompt_tokens, "output_tokens": u.completion_tokens} if u else None

    if cfg["schema"]:
        data = json.loads(content)
    else:
        # 스키마 미지원(Gemma): thought 제거 후 파싱, 실패하면 정리된 원문을 raw_text로.
        clean = _strip_thought(content)
        try:
            data = _parse_json(clean)
        except Exception:
            data = {"receipts": [_receipt(raw_text=clean)]}
    data["_usage"] = usage  # 서버가 비용 계산에 사용 (summarize는 무시)
    return data


# ---- 전용 파서: 이미지→OCR+좌표→필드추출(클라우드) → 우리 스키마로 매핑 ----

def _gcp_key():
    """Vision·DocAI 공용 GCP API 키. GCP_API_KEY > DOCAI_API_KEY."""
    k = os.getenv("GCP_API_KEY") or os.getenv("DOCAI_API_KEY")
    if not k:
        raise RuntimeError("GCP_API_KEY(또는 DOCAI_API_KEY)가 없습니다.")
    return k


def _extract_vision(image_path):
    """Google Cloud Vision DOCUMENT_TEXT_DETECTION → 전체 텍스트를 raw_text로.
    한국어 등 다국어 OCR 강함. 구조화(상호/총액 분리)는 안 하고 원문만 반환."""
    import urllib.request
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    body = json.dumps({"requests": [{"image": {"content": b64},
                                     "features": [{"type": "DOCUMENT_TEXT_DETECTION"}]}]}).encode()
    req = urllib.request.Request(
        f"https://vision.googleapis.com/v1/images:annotate?key={_gcp_key()}",
        data=body, headers={"Content-Type": "application/json"})
    r0 = json.load(urllib.request.urlopen(req, timeout=60))["responses"][0]
    if "error" in r0:
        raise RuntimeError(r0["error"].get("message", "vision error"))
    text = r0.get("fullTextAnnotation", {}).get("text", "")
    return {"receipts": [_receipt(raw_text=text)]}


def _map_textract(resp):
    """AnalyzeExpense 응답(dict) → {"receipts":[...]}. 순수 함수(네트워크 X) — selfcheck 대상."""
    receipts = []
    for doc in resp.get("ExpenseDocuments", []):
        summ = {}
        for sf in doc.get("SummaryFields", []):
            t = (sf.get("Type", {}).get("Text") or "").upper()
            summ.setdefault(t, sf.get("ValueDetection", {}).get("Text"))
        items, texts = [], [v for v in summ.values() if v]
        for g in doc.get("LineItemGroups", []):
            for li in g.get("LineItems", []):
                row = {}
                for f in li.get("LineItemExpenseFields", []):
                    t = (f.get("Type", {}).get("Text") or "").upper()
                    v = f.get("ValueDetection", {}).get("Text")
                    row[t] = v
                    if v:
                        texts.append(v)
                name = row.get("ITEM") or row.get("PRODUCT_CODE")
                if name:
                    items.append({"name": name.strip(), "quantity": _num(row.get("QUANTITY")),
                                  "unit_price": _num(row.get("UNIT_PRICE")), "amount": _num(row.get("PRICE"))})
        receipts.append(_receipt(
            store=summ.get("VENDOR_NAME") or summ.get("NAME"),
            date=summ.get("INVOICE_RECEIPT_DATE"),
            items=items,
            total=_num(summ.get("TOTAL") or summ.get("AMOUNT_DUE")),
            raw_text=" ".join(texts),
        ))
    return {"receipts": receipts or [_receipt()]}


def _extract_textract(image_path):
    import boto3  # 미설치/자격증명 없으면 여기서 예외 → 서버가 502로 안내

    with open(image_path, "rb") as f:
        data = f.read()
    client = boto3.client("textract", region_name=os.getenv("AWS_REGION", "ap-northeast-2"))
    return _map_textract(client.analyze_expense(Document={"Bytes": data}))


def _extract_docai(image_path):
    from google.cloud import documentai  # 미설치/자격증명 없으면 예외 → 502

    project = os.environ["DOCAI_PROJECT"]
    location = os.getenv("DOCAI_LOCATION", "us")          # Expense Parser 프로세서 리전
    processor = os.environ["DOCAI_PROCESSOR_ID"]          # GCP 콘솔에서 만든 프로세서 ID
    # Doc AI 전용 키. Gemini/Gemma의 GOOGLE_API_KEY와 별개.
    # DOCAI_API_KEY 있으면 API 키 인증, 없으면 서비스계정(GOOGLE_APPLICATION_CREDENTIALS) 폴백.
    # DocAI는 API 키 미지원 → ADC(서비스계정 JSON=GOOGLE_APPLICATION_CREDENTIALS, 또는 gcloud ADC) 사용.
    opts = {"api_endpoint": f"{location}-documentai.googleapis.com"}
    client = documentai.DocumentProcessorServiceClient(client_options=opts)
    name = client.processor_path(project, location, processor)

    with open(image_path, "rb") as f:
        content = f.read()
    doc = client.process_document(request=documentai.ProcessRequest(
        name=name, raw_document=documentai.RawDocument(content=content, mime_type=f"image/{_mime(image_path)}"))).document

    store = date = total = None
    items = []
    for e in doc.entities:
        t = e.type_
        if t == "supplier_name":
            store = e.mention_text
        elif t in ("receipt_date", "purchase_date", "invoice_date"):
            date = e.mention_text
        elif t == "total_amount":
            total = _num(e.mention_text)
        elif t == "line_item":
            row = {"name": (e.mention_text or "").strip(), "quantity": None, "unit_price": None, "amount": None}
            for p in e.properties:
                pt = p.type_.split("/")[-1]
                if pt in ("description", "product_code"):
                    row["name"] = (p.mention_text or "").strip() or row["name"]
                elif pt == "quantity":
                    row["quantity"] = _num(p.mention_text)
                elif pt in ("unit_price", "unit_price_amount"):
                    row["unit_price"] = _num(p.mention_text)
                elif pt in ("amount", "total_amount", "line_item_amount"):
                    row["amount"] = _num(p.mention_text)
            if row["name"]:
                items.append(row)
    return {"receipts": [_receipt(store, date, items, total, doc.text or "")]}


def check_totals(data):
    # 합계검증 규칙은 totals_match() 한 곳. 여기선 CLI 출력만.
    for i, r in enumerate(data["receipts"], 1):
        s = sum(it["amount"] or 0 for it in r["items"])
        print(f"  receipt {i}: items={len(r['items'])} sum={s} total={r['total']} "
              f"{'OK' if totals_match(r) else 'MISMATCH'}")


def selfcheck():
    def strict_ok(node):
        if node.get("type") == "object" or "properties" in node:
            assert node.get("additionalProperties") is False, "additionalProperties must be false"
            assert set(node["required"]) == set(node["properties"]), "required must list every prop"
            for v in node["properties"].values():
                strict_ok(v)
        if node.get("type") == "array":
            strict_ok(node["items"])

    strict_ok(SCHEMA)
    sample = ('{"receipts":[{"store":"보령약국","date":"2025-04-17",'
              '"items":[{"name":"써버쿨키드크림[15g]","quantity":3,"unit_price":2000,"amount":6000}],'
              '"total":6000,"raw_text":"보령약국\\n써버쿨키드크림[15g] 3 6000\\n합계 6000"}]}')
    data = json.loads(sample)
    assert data["receipts"][0]["items"][0]["name"] == "써버쿨키드크림[15g]"
    check_totals(data)  # 6000 == 6000 → OK

    # _num: 통화/콤마 텍스트에서 숫자만
    assert _num("1,200원") == 1200 and _num("$3.50") == 3.5
    assert _num(None) is None and _num("없음") is None

    # Textract 매핑: 응답 dict → 우리 스키마
    tx = _map_textract({"ExpenseDocuments": [{
        "SummaryFields": [
            {"Type": {"Text": "VENDOR_NAME"}, "ValueDetection": {"Text": "CU"}},
            {"Type": {"Text": "TOTAL"}, "ValueDetection": {"Text": "5,300"}},
        ],
        "LineItemGroups": [{"LineItems": [{"LineItemExpenseFields": [
            {"Type": {"Text": "ITEM"}, "ValueDetection": {"Text": "삼각김밥"}},
            {"Type": {"Text": "PRICE"}, "ValueDetection": {"Text": "1,200"}},
            {"Type": {"Text": "QUANTITY"}, "ValueDetection": {"Text": "2"}},
        ]}]}],
    }]})
    r = tx["receipts"][0]
    assert r["store"] == "CU" and r["total"] == 5300
    assert r["items"][0] == {"name": "삼각김밥", "quantity": 2, "unit_price": None, "amount": 1200}

    # Gemma thinking 출력 처리: 닫힌 <thought>(내부 예시 JSON 포함) 제거 후 펜스 JSON 파싱
    gemma_out = ('<thought>추론 중 {"store":"WRONG"} ...</thought>```json\n'
                 '{"store":"E-MART","total":6000}\n```')
    p = _parse_json(_strip_thought(gemma_out))
    assert p["store"] == "E-MART" and p["total"] == 6000
    # 안 닫힌 thought(토큰 잘림) + 뒤 JSON → JSON만 살림
    assert _parse_json(_strip_thought('<thought>bla bla {"total":10}'))["total"] == 10

    # cost_of: 토큰 요금(입출력 합산) + 페이지 요금 + usage 없음
    assert cost_of("gemini", {"input_tokens": 1_000_000, "output_tokens": 0}) == 0.15
    assert cost_of("gemini", {"input_tokens": 0, "output_tokens": 1_000_000}) == 0.60
    assert cost_of("textract", None) == 0.01
    assert cost_of("openai", None) is None
    print("selfcheck OK")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--selfcheck":
        selfcheck()
    elif len(sys.argv) == 2:
        data = extract(sys.argv[1])
        print(json.dumps(data, ensure_ascii=False, indent=2))
        print("\n합계검증:")
        check_totals(data)
    else:
        sys.exit("usage: python3 ocr_test.py <receipt_image> | --selfcheck")
