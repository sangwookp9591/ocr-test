# 영수증 OCR 서버 — VLM(OpenAI/Gemini/Gemma) + 전용 파서(Textract/DocAI)
FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py ocr_test.py ./

EXPOSE 8000
# 키는 런타임에 -e / --env-file 로 주입 (OPENAI_API_KEY, GOOGLE_API_KEY, AWS_*, DOCAI_* 등)
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
