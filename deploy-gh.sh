#!/usr/bin/env bash
#
# Convenience: build the web app and deploy it to GitHub Pages (gh-pages branch)
# from the repo root. Wrapper around frontend/scripts/publish-gh-pages.sh.
#
# Pass BASE_PATH=/ for a custom domain / user page:  BASE_PATH=/ ./deploy-gh.sh
#
set -euo pipefail

cd "$(dirname "$0")/frontend"

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (first run)…"
  npm install
fi

exec npm run gh "$@"
