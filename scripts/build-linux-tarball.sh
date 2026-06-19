#!/usr/bin/env bash
# Build a portable .tar.gz from the Tauri .deb bundle (run after `tauri build --bundles deb`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ARCH="${VISIONOS_LINUX_ARCH:-x64}"
DEB_DIR="$ROOT/src-tauri/target/release/bundle/deb"
OUT_DIR="$ROOT/src-tauri/target/release/bundle/tarball"

if ! command -v dpkg-deb >/dev/null 2>&1; then
  echo "error: dpkg-deb is required (install on Debian/Ubuntu CI runners)" >&2
  exit 1
fi

mapfile -t DEBS < <(find "$DEB_DIR" -maxdepth 1 -name '*.deb' -type f | sort)
if [[ ${#DEBS[@]} -eq 0 ]]; then
  echo "error: no .deb found in $DEB_DIR — run tauri build --bundles deb first" >&2
  exit 1
fi
DEB="${DEBS[0]}"

# Match the .deb filename (e.g. VisionOS_1.0.1_amd64.deb → 1.0.1).
deb_base="$(basename "$DEB" .deb)"
if [[ "$deb_base" =~ ^VisionOS_([^_]+)_ ]]; then
  VERSION="${BASH_REMATCH[1]}"
else
  VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
fi

PKG="VisionOS-${VERSION}-linux-${ARCH}"

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
PKG_DIR="$STAGING/$PKG"
mkdir -p "$PKG_DIR"

echo "Extracting $(basename "$DEB") into tarball layout…"
dpkg-deb -x "$DEB" "$PKG_DIR"

cp "$ROOT/scripts/linux-tarball/install.sh" "$PKG_DIR/install.sh"
cp "$ROOT/scripts/linux-tarball/README.txt" "$PKG_DIR/README.txt"
chmod +x "$PKG_DIR/install.sh"

mkdir -p "$OUT_DIR"
ARCHIVE="$OUT_DIR/${PKG}.tar.gz"
tar -C "$STAGING" -czf "$ARCHIVE" "$PKG"

echo "Created $ARCHIVE"
mapfile -t entries < <(tar -tzf "$ARCHIVE")
count="${#entries[@]}"
printf '%s\n' "${entries[@]:0:20}"
if (( count > 20 )); then
  echo "… ($count entries total)"
else
  echo "($count entries total)"
fi
