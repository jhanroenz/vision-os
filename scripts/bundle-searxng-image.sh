#!/usr/bin/env bash
# Save the SearXNG Docker image for offline/portable VisionOS installs.
# Requires Docker (or Podman with docker CLI shim). The engine must exist on the target machine.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/bundle-runtime/docker/searxng-image.tar"
IMAGE="${SEARXNG_IMAGE:-searxng/searxng:latest}"
TAG="visionos-searxng:local"

mkdir -p "$(dirname "$OUT")"

echo "Pulling $IMAGE…"
docker pull "$IMAGE"
docker tag "$IMAGE" "$TAG"
echo "Saving $TAG → $OUT"
docker save "$TAG" -o "$OUT"
echo "Bundled SearXNG image ($(du -h "$OUT" | cut -f1))"
