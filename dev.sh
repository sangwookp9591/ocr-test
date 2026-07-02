#!/bin/bash
# 사용법: bash dev.sh [device-udid]
# LAN IP 자동 반영 -> 백엔드 서버 실행 -> 앱 재빌드(expo run:ios) 까지 한번에.
set -e
cd "$(dirname "$0")"

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
[ -z "$IP" ] && { echo "❌ LAN IP를 못 찾았습니다 (Wi-Fi 연결 확인)"; exit 1; }
echo "▶ LAN IP: $IP"

# 1) app/.env에 IP 반영
sed -i '' -E "s#(EXPO_PUBLIC_RECEIPT_API=http://)[^:]+(:8000/receipt)#\1$IP\2#" app/.env
echo "▶ app/.env: $(cat app/.env)"

# 2) 기존 서버/번들러 정리 후 백엔드 재시작
lsof -ti:8000 2>/dev/null | xargs kill -9 2>/dev/null
lsof -ti:8081 2>/dev/null | xargs kill -9 2>/dev/null
nohup bash start.sh > /tmp/ocr-backend.log 2>&1 &
echo "▶ 백엔드 서버 시작 (PID $!, 로그: /tmp/ocr-backend.log)"
sleep 2

# 3) 실기기 재빌드/실행 (Metro도 같이 뜸)
DEVICE_ID="${1:-00008120-001424E41144C01E}"
cd app
npx expo run:ios --device "$DEVICE_ID"
