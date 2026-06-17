#!/usr/bin/env bash
# Legacy wrapper — use: node searxng/logs.mjs
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/searxng/logs.mjs" "$@"
