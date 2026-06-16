#!/usr/bin/env bash
# Start SearXNG for VisionOS. Supports dev tree and packaged resources (VISIONOS_ROOT).
set -euo pipefail

ROOT="${VISIONOS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
COMPOSE_FILE="$ROOT/searxng/docker-compose.yml"
CONTAINER="visionos-searxng"
PORT="${SEARXNG_PORT:-8080}"
URL="http://localhost:${PORT}/"
IMAGE_TAR="$ROOT/docker/searxng-image.tar"
BUNDLED_IMAGE="visionos-searxng:local"

compose() {
  if command -v docker >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  elif command -v podman >/dev/null 2>&1; then
    podman compose -f "$COMPOSE_FILE" "$@"
  else
    echo "Docker or Podman is required for bundled SearXNG." >&2
    exit 1
  fi
}

load_image() {
  local loader="docker"
  if ! command -v docker >/dev/null 2>&1 && command -v podman >/dev/null 2>&1; then
    loader="podman"
  fi

  if [[ -f "$IMAGE_TAR" ]]; then
    if ! "$loader" image inspect "$BUNDLED_IMAGE" >/dev/null 2>&1; then
      echo "Loading bundled SearXNG image from $IMAGE_TAR…"
      "$loader" load -i "$IMAGE_TAR"
    fi
    export SEARXNG_IMAGE="$BUNDLED_IMAGE"
  fi
}

is_healthy() {
  curl -sf --max-time 2 "$URL" >/dev/null 2>&1
}

if is_healthy; then
  echo "SearXNG already running at $URL"
  exit 0
fi

load_image

echo "SearXNG not responding — recreating container…"

compose down 2>/dev/null || true
podman rm -f "$CONTAINER" 2>/dev/null || true
docker rm -f "$CONTAINER" 2>/dev/null || true

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
