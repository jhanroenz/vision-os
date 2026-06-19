#!/usr/bin/env bash
# Install VisionOS from a portable Linux tarball (no root required by default).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="VisionOS"
PREFIX="${VISIONOS_PREFIX:-${HOME}/.local}"
UNINSTALL=0
SYSTEM=0
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Install VisionOS to a local prefix (default: ~/.local) without needing root.

Options:
  --prefix DIR   Install under DIR (bin, lib, share merged into this tree)
  --system       Install system-wide under /usr/local (uses sudo when needed)
  --uninstall    Remove files recorded by the last install for this prefix
  --dry-run      Print actions without changing the filesystem
  -h, --help     Show this help

Environment:
  VISIONOS_PREFIX   Same as --prefix

After install, ensure ~/.local/bin is on your PATH and launch "VisionOS"
from your app menu or run: visionos

Runtime libraries are not bundled. Install WebKit/GTK packages for your
distro first (see README.txt). Quick examples:

  Debian/Ubuntu:  sudo apt install libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2
  Fedora:         sudo dnf install webkit2gtk4.1 libappindicator-gtk3 librsvg2
  Arch:           sudo pacman -S --needed webkit2gtk-4.1 gtk3 librsvg libappindicator-gtk3
  openSUSE:       sudo zypper install libwebkit2gtk-4.1-0 libappindicator-gtk3 librsvg-2-2
EOF
}

lib_present() {
  local lib="$1"
  ldconfig -p 2>/dev/null | grep -Fq "$lib"
}

detect_distro_id() {
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
    printf '%s' "${ID:-unknown}"
    return 0
  fi
  printf '%s' "unknown"
}

print_dependency_hints() {
  local id
  id="$(detect_distro_id)"
  case "$id" in
    ubuntu | debian | linuxmint | pop | elementary | neon | zorin)
      echo "  Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2" >&2
      ;;
    fedora | rhel | centos | rocky | almalinux | nobara)
      echo "  Fedora/RHEL:   sudo dnf install webkit2gtk4.1 libappindicator-gtk3 librsvg2" >&2
      ;;
    arch | manjaro | endeavouros | garuda | cachyos)
      echo "  Arch:          sudo pacman -S --needed webkit2gtk-4.1 gtk3 librsvg libappindicator-gtk3" >&2
      echo "  Arch (AUR):    if ldd still reports libayatana-appindicator3.so.1 missing, install ayatana-libappindicator from AUR" >&2
      ;;
    opensuse* | sles | opensuse-leap | opensuse-tumbleweed | suse)
      echo "  openSUSE:      sudo zypper install libwebkit2gtk-4.1-0 libappindicator-gtk3 librsvg-2-2" >&2
      ;;
    *)
      echo "  Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2" >&2
      echo "  Fedora:        sudo dnf install webkit2gtk4.1 libappindicator-gtk3 librsvg2" >&2
      echo "  Arch:          sudo pacman -S --needed webkit2gtk-4.1 gtk3 librsvg libappindicator-gtk3" >&2
      echo "  openSUSE:      sudo zypper install libwebkit2gtk-4.1-0 libappindicator-gtk3 librsvg-2-2" >&2
      ;;
  esac
  echo "  Diagnose:        ldd \"\$PREFIX/bin\"/* 2>/dev/null | grep 'not found' || true" >&2
}

log() { printf '==> %s\n' "$*"; }
run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run]'; printf ' %q' "$@"; printf '\n'
  else
    "$@"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)
      PREFIX="${2:?missing directory after --prefix}"
      shift 2
      ;;
    --system)
      SYSTEM=1
      PREFIX="/usr/local"
      shift
      ;;
    --uninstall)
      UNINSTALL=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

MANIFEST="${PREFIX}/share/visionos/install-manifest.txt"
SUDO=""
if [[ "$SYSTEM" -eq 1 ]] && [[ "$(id -u)" -ne 0 ]]; then
  SUDO="sudo"
fi

write_manifest_line() {
  local path="$1"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$MANIFEST")"
  echo "$path" >>"$MANIFEST"
}

install_tree() {
  local src="$1"
  local dest="$2"
  [[ -d "$src" ]] || return 0
  run mkdir -p "$dest"
  if command -v rsync >/dev/null 2>&1; then
    run rsync -a "$src/" "$dest/"
  else
    run cp -a "$src/." "$dest/"
  fi
  if [[ "$DRY_RUN" -eq 0 ]]; then
    find "$src" -type f -print | while IFS= read -r file; do
      rel="${file#"$src"/}"
      write_manifest_line "$dest/$rel"
    done
  fi
}

patch_desktop_files() {
  local src_dir="$ROOT/usr/share/applications"
  [[ -d "$src_dir" ]] || return 0
  local dest_dir="$PREFIX/share/applications"
  run mkdir -p "$dest_dir"
  shopt -s nullglob
  for desktop in "$src_dir"/*.desktop; do
    local base dest
    base="$(basename "$desktop")"
    dest="$dest_dir/$base"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "patch desktop $base -> $dest"
      continue
    fi
    sed \
      -e "s|/usr/bin|$PREFIX/bin|g" \
      -e "s|/usr/lib|$PREFIX/lib|g" \
      -e "s|/usr/share|$PREFIX/share|g" \
      "$desktop" >"$dest"
    write_manifest_line "$dest"
  done
  shopt -u nullglob
}

check_dependencies() {
  local missing=0
  local lib

  if ! lib_present "libwebkit2gtk-4.1.so.0"; then
    echo "warning: libwebkit2gtk-4.1.so.0 not found" >&2
    missing=1
  fi

  if ! lib_present "librsvg-2.so.2"; then
    echo "warning: librsvg-2.so.2 not found" >&2
    missing=1
  fi

  if ! lib_present "libayatana-appindicator3.so.1" && ! lib_present "libappindicator.so.3"; then
    echo "warning: no appindicator library found (libayatana-appindicator3.so.1 or libappindicator.so.3)" >&2
    missing=1
  fi

  if [[ "$missing" -eq 1 ]]; then
    echo "Install WebKit/GTK runtime packages for your distro:" >&2
    print_dependency_hints
  fi
}

do_uninstall() {
  if [[ ! -f "$MANIFEST" ]]; then
    echo "No install manifest at $MANIFEST" >&2
    exit 1
  fi
  log "Removing files listed in $MANIFEST"
  tac "$MANIFEST" | while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    if [[ -e "$path" || -L "$path" ]]; then
      run $SUDO rm -rf "$path"
    fi
  done
  run $SUDO rm -f "$MANIFEST"
  log "Uninstall complete."
}

do_install() {
  if [[ ! -d "$ROOT/usr" ]]; then
    echo "error: expected usr/ next to install.sh (extract the full .tar.gz first)" >&2
    exit 1
  fi

  log "Installing $APP_NAME into $PREFIX"
  run $SUDO mkdir -p "$PREFIX/bin" "$PREFIX/lib" "$PREFIX/share"

  if [[ "$DRY_RUN" -eq 0 ]]; then
    run $SUDO mkdir -p "$(dirname "$MANIFEST")"
    : >"$MANIFEST"
  fi

  install_tree "$ROOT/usr/bin" "$PREFIX/bin"
  install_tree "$ROOT/usr/lib" "$PREFIX/lib"

  if [[ -d "$ROOT/usr/share" ]]; then
    shopt -s nullglob
    for entry in "$ROOT/usr/share"/*; do
      base="$(basename "$entry")"
      if [[ "$base" == "applications" ]]; then
        continue
      fi
      install_tree "$entry" "$PREFIX/share/$base"
    done
    shopt -u nullglob
  fi

  patch_desktop_files
  check_dependencies

  log "Done."
  log "Add to PATH if needed:  export PATH=\"$PREFIX/bin:\$PATH\""
  log "Launch from your desktop menu or run: $(ls "$ROOT/usr/bin" 2>/dev/null | head -1 || echo visionos)"
}

if [[ "$UNINSTALL" -eq 1 ]]; then
  do_uninstall
else
  do_install
fi
