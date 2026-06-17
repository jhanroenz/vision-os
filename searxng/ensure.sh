#!/usr/bin/env bash
# Legacy wrapper — use: node searxng/ensure.mjs
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/searxng/ensure.mjs" "$@"
