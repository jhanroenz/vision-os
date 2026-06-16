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
- Linux deps for Tauri: `webkit2gtk`, `libappindicator`, etc. ([Tauri Linux setup](https://v2.tauri.app/start/prerequisites/))

## Quick start

### Web dev (browser tab)

```bash
cd workspace/visionos
npm install
npm run dev
```

Open http://127.0.0.1:5173 — API at `/api/health`.

### Desktop app (Tauri)

```bash
npm run tauri:dev
```

Requires Rust installed. Opens VisionOS in a native window with Chromium webviews for external browsing.

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
