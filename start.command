#!/bin/bash
# Double-click this file (or run ./start.command) to launch EQL Parser.
# It installs dependencies on first run, builds the UI, opens your browser,
# and serves the app at http://localhost:8787. Close the window or press
# Ctrl+C to stop.

cd "$(dirname "$0")" || exit 1

PORT="${EQL_PORT:-8787}"
URL="http://localhost:${PORT}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found. Install it from https://nodejs.org and try again."
  read -r -p "Press Return to close…" _
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)…"
  npm install --cache /tmp/eql-npmcache || npm install || {
    echo "Dependency install failed."; read -r -p "Press Return to close…" _; exit 1;
  }
fi

echo "Building the interface…"
npm run build:web || { echo "UI build failed."; read -r -p "Press Return to close…" _; exit 1; }

# Open the browser a moment after the server comes up.
( for _ in $(seq 1 60); do
    curl -s -o /dev/null "$URL/api/config" && break
    sleep 0.5
  done
  open "$URL" >/dev/null 2>&1 ) &

echo ""
echo "▶ EQL Parser running at ${URL}"
echo "  Close this window or press Ctrl+C to stop."
echo ""

exec node --import tsx src/index.ts
