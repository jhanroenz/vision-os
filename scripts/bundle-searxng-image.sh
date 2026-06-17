#!/usr/bin/env bash
# Legacy wrapper — use: node scripts/bundle-searxng-image.mjs
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/bundle-searxng-image.mjs" "$@"
