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
