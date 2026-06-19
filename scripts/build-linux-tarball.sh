#!/usr/bin/env bash
# Build a portable .tar.gz from the Tauri .deb bundle (run after `tauri build --bundles deb`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
ARCH="${VISIONOS_LINUX_ARCH:-x64}"
DEB_DIR="$ROOT/src-tauri/target/release/bundle/deb"
OUT_DIR="$ROOT/src-tauri/target/release/bundle/tarball"
PKG="VisionOS-${VERSION}-linux-${ARCH}"

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
tar -tzf "$ARCHIVE" | head -20
echo "… ($(tar -tzf "$ARCHIVE" | wc -l) entries total)"
