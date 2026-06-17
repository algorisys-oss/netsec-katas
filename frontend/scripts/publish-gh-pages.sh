#!/usr/bin/env bash
#
# Build the SPA and publish it to the `gh-pages` branch of origin.
# Dependency-free: builds with the correct base path, adds an SPA deep-link
# fallback (404.html) + .nojekyll, then force-pushes dist/ to gh-pages.
#
# Usage:   npm run gh            (from the frontend/ directory)
#   or:    BASE_PATH=/ ./scripts/publish-gh-pages.sh   (custom domain / user page)
#
set -euo pipefail

BRANCH="gh-pages"
BASE_PATH="${BASE_PATH:-/netsec-katas/}"   # GitHub Pages project site: /<repo>/

# Run from the frontend/ directory regardless of where invoked.
cd "$(dirname "$0")/.."
FRONTEND_DIR="$(pwd)"

ROOT="$(git -C "$FRONTEND_DIR" rev-parse --show-toplevel)"
REMOTE_URL="$(git -C "$ROOT" remote get-url origin)"
REPO="$(basename "$REMOTE_URL" .git)"
OWNER="$(basename "$(dirname "$REMOTE_URL")" | sed 's/.*://')"

echo "==> Building (base=$BASE_PATH)"
VITE_BASE="$BASE_PATH" npm run build

# SPA fallback: GitHub Pages serves 404.html for unknown paths, preserving the
# URL, so a copy of index.html lets deep links like /kata/n08 load the app.
cp dist/index.html dist/404.html
# Stop Jekyll from ignoring files that start with an underscore.
touch dist/.nojekyll

echo "==> Publishing dist/ to '$BRANCH' on $REMOTE_URL"
TMP="$(mktemp -d)"
cp -a dist/. "$TMP/"
(
  cd "$TMP"
  git init -q
  git checkout -q -b "$BRANCH"
  git add -A
  git -c user.email="deploy@local" -c user.name="deploy" \
      commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
      git push -f -q "$REMOTE_URL" "$BRANCH"
)
rm -rf "$TMP"

echo "==> Done."
echo "    URL: https://${OWNER}.github.io/${REPO}/"
echo "    First time only: GitHub repo → Settings → Pages →"
echo "      Source: 'Deploy from a branch', Branch: ${BRANCH} / (root), then Save."
