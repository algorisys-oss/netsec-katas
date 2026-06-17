#!/usr/bin/env bash
#
# Convenience: build the web app and publish it to GitHub Pages (gh-pages branch)
# from the repo root. Thin wrapper around frontend/scripts/publish-gh-pages.sh.
#
# Pass BASE_PATH=/ for a custom domain / user page:  BASE_PATH=/ ./gh.sh
#
set -euo pipefail

cd "$(dirname "$0")/frontend"

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (first run)…"
  npm install
fi

exec npm run gh "$@"
