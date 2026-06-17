# VisionOS

Jarvis desktop shell — SvelteKit frontend + backend, packaged with **Tauri** (real Chromium webviews). VisionOS is a **standalone** Jarvis instance (successor to `gemma-agent`); the full backend runs in SvelteKit server routes.

## Architecture

```
VisionOS (Tauri desktop app)
├── Frontend   SvelteKit UI — OS shell, windows, apps
├── Backend    SvelteKit API routes + src/lib/server/ (Jarvis agent)
└── Browser    External URLs → dedicated Tauri Chromium webview windows
```

## Prerequisites

- **Node.js** 20+
- **Rust** toolchain ([rustup](https://rustup.rs)) — required for Tauri desktop builds
- **Docker Desktop** (or Podman) — optional but recommended for local SearXNG web search in dev
- **Linux** (Tauri): `webkit2gtk`, `libappindicator`, etc. ([Tauri Linux setup](https://v2.tauri.app/start/prerequisites/))
- **Windows** (Tauri): [Visual Studio C++ build tools](https://v2.tauri.app/start/prerequisites/) + [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)
- **macOS** (Tauri): Xcode command line tools

Dev scripts are **Node.js** (`searxng/*.mjs`) and work on Windows, macOS, and Linux. Bash is not required.

## Quick start

### Web dev (browser tab)

```bash
cd vision-os
npm install
npm run dev
```

`npm run dev` ensures SearXNG is running (Docker when available, otherwise bundled Python if you ran `npm run prepare:release`), then starts Vite.

Open http://127.0.0.1:5173 — API at `/api/health`.

**SearXNG without Docker:** `npm run prepare:release` then `SEARXNG_USE_BUNDLED=true npm run dev`

### Desktop app (Tauri)

Requires **Rust** (`cargo`) and platform build tools. On Windows, install:

1. [Rustup](https://rustup.rs) — `winget install Rustlang.Rustup`, then **open a new terminal**
2. [VS 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — workload **Desktop development with C++**  
   Default install location on this repo: **`D:\Microsoft Visual Studio\2022\BuildTools`**

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/install-msvc-build-tools.ps1
   ```
3. [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (usually already on Windows 11)

```bash
npm run tauri:dev
```

Opens VisionOS in a native window with Chromium webviews for external browsing.

**Web-only dev** (no Rust): use `npm run dev` and open http://127.0.0.1:5173 in your browser.

### Production build

```bash
npm run build      # SvelteKit adapter-node → build/
npm run tauri:build  # Native .deb / .AppImage / binary
```

## Environment

VisionOS ships with a migrated `.env` (copied from your gemma-agent setup). Edit as needed:

- `DATABASE_PATH` — points at `../../gemma-agent/data/jarvis.db` to reuse existing Jarvis data
- `WORKSPACE_DIR` — your projects root
- `PORT` — adapter-node listen port (5173; Vite dev also uses 5173)

Fresh setup: `cp .env.example .env` and add API keys.

## Backend

All Jarvis API routes are served from SvelteKit:

| Area | Routes |
|------|--------|
| Health | `GET /api/health` |
| Settings | `/api/settings`, `/api/settings/llm/*` |
| Conversations | `/api/conversations/*` |
| Workspace | `/api/workspace/*` |
| Chat | `POST /api/chat`, `POST /api/chat/stream` (SSE) |
| Brain | `/api/memories`, `/api/skills`, `/api/failures` |
| Research | `/api/research/*` |
| Evolution | `/api/evolution/*` |
| Shell | `/api/shell/*` |

Server logic lives in `src/lib/server/` (ported from gemma-agent). Route handlers in `src/lib/server/handlers/`; thin `+server.ts` files in `src/routes/api/`.

## Browser app

- `visionos://*` — internal pages in the in-app iframe panel
- `https://*` — **Tauri**: real Chromium `WebviewWindow` | **Web**: system tab

## Project structure

```
visionos/
├── data/                    # SQLite DB, transcripts (created at runtime)
├── src/
│   ├── routes/api/          # SvelteKit API routes
│   ├── lib/server/          # Jarvis backend modules
│   ├── lib/platform/        # Tauri detection + browser launcher
│   └── lib/components/      # OS shell + apps
├── src-tauri/               # Rust / Tauri desktop shell
└── build/                   # adapter-node output (after npm run build)
```
