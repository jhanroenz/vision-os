#!/usr/bin/env bash
# Start SearXNG for local dev. Recreates the container if Podman/crun state is stale.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT/searxng/docker-compose.yml"
CONTAINER="visionos-searxng"
PORT="${SEARXNG_PORT:-8080}"
URL="http://localhost:${PORT}/"

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

is_healthy() {
  curl -sf --max-time 2 "$URL" >/dev/null 2>&1
}

if is_healthy; then
  echo "SearXNG already running at $URL"
  exit 0
fi

echo "SearXNG not responding — recreating container…"

# Podman/crun can leave a ghost container with a missing exec.fifo.
compose down 2>/dev/null || true
podman rm -f "$CONTAINER" 2>/dev/null || true

compose up -d

for _ in $(seq 1 30); do
  if is_healthy; then
    echo "SearXNG ready at $URL"
    exit 0
  fi
  sleep 1
done

echo "SearXNG failed to become healthy within 30s" >&2
compose logs --tail=30 >&2 || true
exit 1
