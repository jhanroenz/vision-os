#!/usr/bin/env bash
# Dev wrapper: ensure SearXNG is up, then stream logs (keeps concurrently alive).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT/searxng/docker-compose.yml"

"$ROOT/searxng/ensure.sh"
exec docker compose -f "$COMPOSE_FILE" logs -f
