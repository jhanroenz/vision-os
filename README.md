# VisionOS

Desktop AI environment — **SvelteKit** UI + Jarvis agent backend, packaged with **Tauri**.

Build your own apps in **Chat → App Builder**; they appear in **My Apps** on the desktop. Built-in apps include Chat, Research, Files, Terminal, Browser, Settings, and more.

**Releases:** [github.com/jhanroenz/vision-os/releases](https://github.com/jhanroenz/vision-os/releases)

---

## Install

Download the latest release for your platform. Packaged builds bundle Node, Python, and SearXNG — set up your LLM in **Settings** after first launch.

| Platform | File | How to install |
|----------|------|----------------|
| **Windows** | `*-setup.exe` | Run installer → Start menu |
| **macOS** (Apple Silicon) | `*.dmg` | Open DMG → drag to Applications |
| **Linux** | `.deb` | `sudo apt install ./VisionOS_*_amd64.deb` |
| **Linux** | `.AppImage` | `chmod +x VisionOS*.AppImage && ./VisionOS*.AppImage` |
| **Linux** | `.tar.gz` | Portable install — [see below](#linux-portable-tarball) |

### Linux portable tarball

For **x86_64 glibc** distros (Debian, Fedora, Arch, openSUSE). Not supported: Alpine/musl, arm64.

```bash
tar -xzf VisionOS-*-linux-x64.tar.gz
cd VisionOS-*-linux-x64
./install.sh          # installs to ~/.local
```

Add `~/.local/bin` to your `PATH`. Also: `./install.sh --system`, `./install.sh --prefix /opt/visionos`, `./install.sh --uninstall`.

**Runtime libraries** (WebKit/GTK — install once per machine):

| Distro | Command |
|--------|---------|
| Debian / Ubuntu / Mint | `sudo apt install libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2` |
| Fedora / RHEL / Rocky | `sudo dnf install webkit2gtk4.1 libappindicator-gtk3 librsvg2` |
| Arch / Manjaro | `sudo pacman -S --needed webkit2gtk-4.1 gtk3 librsvg libappindicator-gtk3` |
| openSUSE | `sudo zypper install libwebkit2gtk-4.1-0 libappindicator-gtk3 librsvg-2-2` |

If the app won't start: `ldd ~/.local/bin/* | grep 'not found'`. On Arch, missing `libayatana-appindicator3.so.1` → install `ayatana-libappindicator` from AUR.

---

## Development

### Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js 22+** | `npm ci` |
| **Rust** | [rustup.rs](https://rustup.rs) — for `npm run tauri:dev` / `tauri:build` |
| **Linux** | WebKit/GTK dev packages — [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) |
| **Windows** | [VS C++ build tools](https://v2.tauri.app/start/prerequisites/) + WebView2 |
| **macOS** | Xcode command line tools |
| **Docker** (optional) | SearXNG web search in dev (`npm run dev` starts it when Docker is available) |

Dev scripts are cross-platform Node.js (`searxng/*.mjs`); bash is not required.

### Setup

```bash
git clone https://github.com/jhanroenz/vision-os.git
cd vision-os
npm ci
cp .env.example .env   # optional — LLM keys, WORKSPACE_DIR
```

Most options live in the **Settings** app (SQLite). `.env` is for bootstrap: `PORT`, `DATABASE_PATH`, API keys. A fresh clone works without `.env`.

### Run

```bash
npm run dev          # browser — http://127.0.0.1:5173
npm run tauri:dev    # native window (boot splash → desktop)
```

Health: `GET /api/health`

**SearXNG without Docker:** `npm run prepare:release` then `SEARXNG_USE_BUNDLED=true npm run dev`

**Windows Tauri extras:** Rustup (`winget install Rustlang.Rustup`), VS 2022 C++ workload, WebView2. Or run `powershell -ExecutionPolicy Bypass -File scripts/install-msvc-build-tools.ps1`.

### Build installers

```bash
npm run tauri:build              # .deb / NSIS / DMG on current OS
npm run build:linux-tarball      # .tar.gz (after a Linux .deb build)
```

---

## First launch

1. **LLM** — Open **Settings → LLM**, pick a provider preset, paste API key, **Test connection**, **Save**.  
   Quick picks: **Groq** or **OpenRouter** (free cloud), **Local** (Ollama at `http://localhost:11434/v1`), **Cursor** (best for App Builder, model `auto`).
2. **Workspace** — Agent files default to `~/VisionOS/workspace` (override with `WORKSPACE_DIR` in `.env`).
3. **Verify** — Send a Chat message; try **App Builder** for a simple app → check **My Apps**.

Full provider list and env vars: see [LLM providers](#llm-providers) and `.env.example`.

---

## LLM providers

OpenAI-compatible API (`/v1/chat/completions`). Configure in **Settings** or `.env`.

| Provider | Settings label | Key variable | Good for |
|----------|----------------|--------------|----------|
| `local` | Local | — | Ollama / llama.cpp offline |
| `openai` | OpenAI | `OPENAI_API_KEY` | General chat |
| `gemini` | Google Gemini | `GEMINI_API_KEY` | Large context |
| `groq` | Groq | `GROQ_API_KEY` | Fast free tier |
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY` | Many models, one key |
| `cerebras` | Cerebras | `CEREBRAS_API_KEY` | Fast hosted |
| `cursor` | Cursor SDK | `CURSOR_API_KEY` | **App Builder** (use model `auto`) |
| `custom` | Custom URL | `LLM_API_KEY` | LM Studio, vLLM, etc. |

**Settings vs `.env`:** Settings saves to SQLite and applies immediately; `.env` loads at server start (good for CI and first boot).

---

## Architecture

```
Tauri shell → bundled Node backend (:39247) → SvelteKit UI + /api/*
User apps   → workspace → publish API → My Apps
Browser     → external URLs in dedicated Tauri webview windows
```

| Path | Purpose |
|------|---------|
| `src/routes/` | Pages and API routes |
| `src/lib/server/` | Jarvis backend + user apps |
| `apps/_template/` | Sandbox / schema / service app templates |
| `src-tauri/` | Rust shell, packaging, process management |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Linux won't start | Install WebKit/GTK libs ([table above](#linux-portable-tarball)); `ldd ~/.local/bin/*` |
| No web search (dev) | Start Docker, or use bundled SearXNG (see Run above) |
| No web search (packaged) | Non-fatal — check app data `server.log` |
| Windows API errors | Update to latest release; log in `%APPDATA%\com.jarvis.visionos\` |
| App Builder weak results | Use **Cursor** provider with model **`auto`** |

Tests: `npm run test:user-apps`
