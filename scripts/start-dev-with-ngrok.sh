#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
if [ -f backend/.env ]; then
  ENV_PORT="$(grep -E '^PORT=' backend/.env | tail -n1 | cut -d= -f2)"
  PORT="${ENV_PORT:-$PORT}"
fi

command -v ngrok >/dev/null 2>&1 || { echo "ngrok not installed. brew install ngrok" >&2; exit 1; }

trap 'kill 0' EXIT INT TERM

(cd backend && npm run start:all:dev) &
ngrok http "$PORT" --log=stdout &

wait
