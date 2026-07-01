#!/bin/bash
# 사용법:  OPENAI_API_KEY=sk-실제키 bash start.sh
# 또는:    bash start.sh sk-실제키
cd "$(dirname "$0")"
# Doc AI 등 여분의 env(DOCAI_API_KEY / DOCAI_PROJECT / DOCAI_LOCATION / DOCAI_PROCESSOR_ID,
# AWS_* 등)는 .env.local에 모아두면 자동 로드. git에 올리지 말 것.
# source(.) 대신 줄단위 export — 값에 공백/경로/특수문자가 있어도 명령 실행 안 됨.
if [ -s .env.local ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue;; esac
    export "$line"
  done < .env.local
fi
[ -n "$1" ] && export OPENAI_API_KEY="$1"
[ -z "$OPENAI_API_KEY" ] && [ -s .openai_key ] && export OPENAI_API_KEY="$(tr -d '[:space:]' < .openai_key)"
# Gemini/Gemma(Google AI)용 키. 파일(.google_key)이 있으면 자동 로드. 없으면 OpenAI만 동작.
[ -z "$GOOGLE_API_KEY" ] && [ -s .google_key ] && export GOOGLE_API_KEY="$(tr -d '[:space:]' < .google_key)"
if [ -z "$OPENAI_API_KEY" ] && [ -z "$GOOGLE_API_KEY" ]; then
  echo "❌ 키가 없습니다.  OPENAI_API_KEY=sk-... bash start.sh  (또는 .openai_key / .google_key 파일)"
  exit 1
fi
echo "▶ 서버 시작: http://<YOUR_LAN_IP>:8000  (Ctrl+C로 종료)"
exec .venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000
