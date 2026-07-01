#!/bin/bash
# Docker로 서버 빌드+실행. 키는 .openai_key / .google_key / .env.local 에서 자동 주입.
#   bash docker-run.sh              # 8000 포트로 실행
#   PORT=8001 bash docker-run.sh    # 다른 포트로
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8000}"

ENV_ARGS=()
[ -s .openai_key ] && ENV_ARGS+=(-e "OPENAI_API_KEY=$(tr -d '[:space:]' < .openai_key)")
[ -s .google_key ] && ENV_ARGS+=(-e "GOOGLE_API_KEY=$(tr -d '[:space:]' < .google_key)")
[ -f .env.local ] && ENV_ARGS+=(--env-file .env.local)

docker build -t receipt-ocr .
echo "▶ http://$(ipconfig getifaddr en0 2>/dev/null || echo localhost):${PORT}  (Ctrl+C로 종료)"
exec docker run --rm -p "${PORT}:8000" "${ENV_ARGS[@]}" receipt-ocr
