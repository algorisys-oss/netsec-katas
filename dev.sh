#!/usr/bin/env bash
#
# Convenience: start the web-app dev server from the repo root.
# Installs deps on first run, then launches Vite (http://localhost:5173).
#
set -euo pipefail

cd "$(dirname "$0")/frontend"

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (first run)…"
  npm install
fi

echo "==> Starting dev server → http://localhost:5173"
exec npm run dev "$@"
