#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund
fi

PORT=3210 node server.js &
SERVER_PID=$!
sleep 1

if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
  echo "Server failed to start. Is port 3210 already in use?"
  exit 1
fi

NGROK_PID=""
if command -v ngrok >/dev/null 2>&1; then
  ngrok http 3210 --log=stdout > /tmp/ludo-ngrok.log 2>&1 &
  NGROK_PID=$!
  sleep 3
  PUBLIC_URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['tunnels'][0]['public_url'] if d.get('tunnels') else '')" 2>/dev/null || true)
  echo ""
  echo "=================================================="
  if [ -n "${PUBLIC_URL}" ]; then
    echo "  Local:  http://localhost:3210"
    echo "  Online: ${PUBLIC_URL}"
    echo ""
    echo "  Share the Online URL + room code with your friend."
    echo "  Open the lobby on the admin's device to start the game."
  else
    echo "  Local:  http://localhost:3210"
    echo "  ngrok URL not available yet. Check /tmp/ludo-ngrok.log"
  fi
  echo "=================================================="
  echo ""
else
  echo ""
  echo "Local: http://localhost:3210"
  echo "Install ngrok to play over the internet: https://ngrok.com/download"
  echo ""
fi

trap 'kill ${SERVER_PID} ${NGROK_PID} 2>/dev/null' EXIT INT TERM
wait ${SERVER_PID}
