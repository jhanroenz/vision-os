#!/usr/bin/env bash
# Legacy wrapper — use: node searxng/dev-wrapper.mjs tauri:dev:raw
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/searxng/dev-wrapper.mjs" tauri:dev:raw
