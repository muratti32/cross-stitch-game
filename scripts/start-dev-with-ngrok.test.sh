#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/start-dev-with-ngrok.sh"

grep -F 'docker compose up -d --wait postgres redis conversion-engine' "$SCRIPT" >/dev/null
grep -F 'npm run migration:run' "$SCRIPT" >/dev/null
grep -F 'kill "$BACKEND_PID" "$NGROK_PID"' "$SCRIPT" >/dev/null

echo "start-dev-with-ngrok regression checks passed"
