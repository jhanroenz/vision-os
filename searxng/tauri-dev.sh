#!/usr/bin/env bash
# Ensure SearXNG is up, run Tauri dev, and always tear SearXNG down on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  npm --prefix "$ROOT" run searxng:down >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

"$ROOT/searxng/ensure.sh"
cd "$ROOT"
exec npm run tauri:dev:raw
