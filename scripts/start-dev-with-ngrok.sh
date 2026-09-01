#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
if [ -f backend/.env ]; then
  ENV_PORT="$(sed -n 's/^PORT=//p' backend/.env | tail -n1)"
  PORT="${ENV_PORT:-$PORT}"
fi

case "$PORT" in
  ''|*[!0-9]*)
    echo "Invalid PORT: $PORT" >&2
    exit 1
    ;;
esac

command -v docker >/dev/null 2>&1 || { echo "docker not installed" >&2; exit 1; }
command -v ngrok >/dev/null 2>&1 || { echo "ngrok not installed. brew install ngrok" >&2; exit 1; }

echo "Starting PostgreSQL, Redis, and Conversion Engine..."
docker compose up -d --wait postgres redis conversion-engine

echo "Applying database migrations..."
(cd backend && npm run migration:run)

BACKEND_PID=""
NGROK_PID=""

cleanup() {
  STATUS=$?
  trap - EXIT INT TERM
  if [ -n "$BACKEND_PID" ] && [ -n "$NGROK_PID" ]; then
    kill "$BACKEND_PID" "$NGROK_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
    wait "$NGROK_PID" 2>/dev/null || true
  fi
  exit "$STATUS"
}

trap cleanup EXIT
trap 'exit 130' INT TERM

(cd backend && npm run start:all:dev) &
BACKEND_PID=$!
ngrok http "$PORT" --log=stdout &
NGROK_PID=$!

while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$NGROK_PID" 2>/dev/null; do
  sleep 1
done

set +e
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  wait "$BACKEND_PID"
  EXIT_STATUS=$?
else
  wait "$NGROK_PID"
  EXIT_STATUS=$?
fi
set -e

exit "$EXIT_STATUS"
