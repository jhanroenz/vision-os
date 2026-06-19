# VisionOS

A desktop AI operating environment built with **SvelteKit** and packaged with **Tauri**. VisionOS is a full Jarvis agent shell: chat, research, workspace tools, and a growing library of apps — including apps you create yourself.

You do **not** need to download third-party apps. Open **Chat → App Builder**, describe what you want, and the agent builds, publishes, and installs it into **My Apps**. Your desktop grows with you.

## What you get

### Built-in apps

Calculator, Notepad, Paint, Files, Terminal, Clock, Calendar, Tasks, Browser, Settings, Chat, Deep Research, and more.

### My Apps — generate anything you need

VisionOS ships with an **App Builder** composer mode in Chat. Describe an app in plain language and the agent will:

1. Scaffold it in your workspace (`~/VisionOS/workspace` by default)
2. Write a `visionos.app.json` manifest (name, icon, type)
3. Publish it to your personal app library

Published apps appear in **Start → My Apps** and on the desktop. Open them like any other window; uninstall from **My Apps** when you are done.

Supported app types:

| Type | What it is |
|------|------------|
| **Sandbox** | HTML/CSS/JS mini-apps served in a sandboxed iframe |
| **Schema** | Declarative UI from JSON schema (lists, stats, forms) |
| **Service** | Background jobs and server-side logic |

Templates live in `apps/_template/` if you want to build by hand or extend what the agent created.

### Jarvis agent backend

The full agent runs inside SvelteKit server routes — conversations, tools, memory, deep research, workspace file access, and shell sessions. LLM setup is covered in [First-time setup](#first-time-setup-guide) and [LLM providers](#llm-providers).

## Architecture

```
VisionOS (Tauri desktop app)
├── Frontend   SvelteKit UI — OS shell, windows, built-in + user apps
├── Backend    SvelteKit API routes + src/lib/server/ (Jarvis agent)
├── User apps  Workspace → publish API → My Apps launcher
└── Browser    External URLs → dedicated Tauri Chromium webview windows
```

## Prerequisites

- **Node.js** 22+ (see `package.json` engines)
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

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/install-msvc-build-tools.ps1
   ```
3. [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (usually already on Windows 11)

```bash
npm run tauri:dev
```

Opens VisionOS in a native window with a boot splash, then the desktop. External sites open in real Chromium webview windows.

**Web-only dev** (no Rust): use `npm run dev` and open http://127.0.0.1:5173 in your browser.

### Production build

```bash
npm run build        # SvelteKit adapter-node → build/
npm run tauri:build  # Native installers (.deb, NSIS, DMG)
```

Pre-built releases: [GitHub Releases](https://github.com/jhanroenz/vision-os/releases).

## First-time setup guide

### 1. Install and run

```bash
git clone https://github.com/jhanroenz/vision-os.git
cd vision-os
npm install
npm run tauri:dev    # desktop  — or npm run dev for browser-only
```

On first launch VisionOS seeds defaults into SQLite, so you can start without a `.env` file. For API keys and bootstrap paths, copy the template:

```bash
cp .env.example .env
```

### 2. Pick an LLM provider

VisionOS needs a language model for **Chat**, **Research**, and **App Builder**. Choose one of the [supported providers](#llm-providers) below.

**Recommended paths:**

| Goal | Provider | Why |
|------|----------|-----|
| Free cloud, quick start | **Groq** or **OpenRouter** | Fast signup, generous free tiers |
| Best App Builder experience | **Cursor (Composer SDK)** | Runs a full coding agent against your workspace |
| Fully offline / private | **Local** (Ollama or llama.cpp) | No API key; runs on your machine |
| Highest quality chat | **OpenAI** or **Gemini** | Strong general reasoning |

Configure in either place (both work; Settings wins after first save):

- **Settings app → LLM** — pick a preset, paste your API key, click **Test connection**, then **Save**
- **`.env`** — set `LLM_PROVIDER` and the matching API key variable, then restart dev server

### 3. Enable web search (optional)

Research and agent web tools use **SearXNG**. With Docker installed, `npm run dev` starts it automatically. Without Docker:

```bash
npm run prepare:release
SEARXNG_USE_BUNDLED=true npm run dev
```

### 4. Set your workspace

The agent and App Builder read/write files under your workspace (default `~/VisionOS/workspace` on macOS/Linux, `%USERPROFILE%\VisionOS\workspace` on Windows). Override in `.env`:

```bash
WORKSPACE_DIR=C:\Users\you\projects
```

User-built apps are published from here into **My Apps**.

### 5. Verify everything works

1. Open **Settings → LLM → Test connection** — should show provider and model name.
2. Open **Chat**, send a short message in **Agent** mode.
3. Switch to **App Builder** and ask for a simple app (e.g. a dice roller). It should appear in **My Apps**.

### 6. Packaged installs

Download a release from [GitHub Releases](https://github.com/jhanroenz/vision-os/releases) for Windows (NSIS), Linux (.deb), or macOS (DMG). API keys can be set in Settings after install — no rebuild required.

## LLM providers

VisionOS speaks the **OpenAI Chat Completions API** (`/v1/chat/completions`). Every preset below uses that shape; **Custom URL** works for any compatible endpoint (LM Studio, Together, Fireworks, etc.).

### Provider overview

| Provider | Label in Settings | API key env var | Default model | Typical use |
|----------|-------------------|-----------------|---------------|-------------|
| `local` | Local (llama.cpp / Ollama) | — | `gemma-4-E2B-it-Q4_K_M.gguf` | Offline, self-hosted |
| `openai` | OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini` | General chat, tool use |
| `gemini` | Google Gemini | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `gemini-2.0-flash` | Large context, multimodal |
| `groq` | Groq (free tier) | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | Fast free cloud inference |
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY` (`sk-or-…`) | `openrouter/free` | Many models, one key |
| `cerebras` | Cerebras | `CEREBRAS_API_KEY` | `gpt-oss-120b` | Fast hosted inference |
| `cursor` | Cursor (Composer SDK) | `CURSOR_API_KEY` | `auto` | **App Builder**, coding tasks |
| `custom` | Custom URL | `LLM_API_KEY` | (you choose) | Any OpenAI-compatible API |

`LLM_API_KEY` is a generic fallback when a provider-specific variable is not set (except OpenRouter, which requires an `sk-or-` key).

### Local (Ollama or llama.cpp)

No API key. Point VisionOS at your local OpenAI-compatible server.

**Ollama** (easiest):

```bash
# Install from https://ollama.com, then:
ollama pull llama3.3
```

In **Settings → LLM**, choose **Local** and set:

- Base URL: `http://localhost:11434/v1`
- Model: your Ollama model name (e.g. `llama3.3`)

Or in `.env`:

```bash
LLM_PROVIDER=local
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=llama3.3
LLM_SLOTS_ENABLED=true
```

**llama.cpp server** — same idea; use its `/v1` endpoint (often `http://localhost:8080/v1`). Local providers support **slot mode** (`LLM_SLOTS_ENABLED`) for parallel requests on one loaded model.

### OpenAI

1. Create a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. **Settings → LLM → OpenAI**, paste key, pick model (e.g. `gpt-4o`, `gpt-4o-mini`)
3. Or `.env`: `LLM_PROVIDER=openai` and `OPENAI_API_KEY=sk-…`

### Google Gemini

1. Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. **Settings → LLM → Google Gemini** — base URL is set automatically to the OpenAI-compatible Gemini endpoint
3. Or `.env`: `LLM_PROVIDER=gemini`, `GEMINI_API_KEY=…`, `LLM_MODEL=gemini-2.0-flash`

### Groq

1. Sign up at [console.groq.com](https://console.groq.com) and create an API key
2. **Settings → LLM → Groq (free tier)**
3. Or `.env`: `LLM_PROVIDER=groq`, `GROQ_API_KEY=gsk_…`

Good default for trying VisionOS without local GPU setup.

### OpenRouter

1. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys) (`sk-or-v1-…`)
2. **Settings → LLM → OpenRouter**
3. Change model to any [OpenRouter model id](https://openrouter.ai/models) — `openrouter/free` routes to free models

```bash
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-…
LLM_MODEL=openrouter/free
```

### Cerebras

1. Get a key at [cloud.cerebras.ai](https://cloud.cerebras.ai)
2. **Settings → LLM → Cerebras**
3. Or `.env`: `LLM_PROVIDER=cerebras`, `CEREBRAS_API_KEY=csk_…`

### Cursor (Composer SDK) — recommended for App Builder

Runs Cursor’s agent SDK locally against your workspace — ideal for multi-file app scaffolding, terminal commands, and publish flows.

1. Create an integration key at [cursor.com/dashboard/integrations](https://cursor.com/dashboard/integrations)
2. **Settings → LLM → Cursor (Composer SDK)**
3. Set model to **`auto`** (recommended). Names like `composer-2.5` often fail on the local SDK runtime; `auto` picks a working model server-side.
4. Or `.env`:

```bash
LLM_PROVIDER=cursor
CURSOR_API_KEY=cursor_…
LLM_MODEL=auto
```

No base URL — the SDK runs on your machine. Use this provider when building apps in **Chat → App Builder**.

### Custom URL

For LM Studio, Together, Fireworks, vLLM, or any other OpenAI-compatible host:

1. **Settings → LLM → Custom URL**
2. Enter base URL (must end in `/v1` except Gemini’s special path)
3. Set model id and `LLM_API_KEY` if the host requires auth

```bash
LLM_PROVIDER=custom
LLM_BASE_URL=http://localhost:1234/v1
LLM_MODEL=your-model-id
LLM_API_KEY=…
```

### Settings vs `.env`

| | **Settings app** | **`.env` file** |
|--|------------------|-----------------|
| Persists in | SQLite database | File on disk |
| API keys | Stored per provider in DB | Read at server boot |
| When it applies | Immediately after **Save** | After server restart |
| Best for | Day-to-day switching, packaged app users | CI, first boot defaults, secrets in dev |

Bootstrap-only variables that still belong in `.env`: `PORT`, `DATABASE_PATH`, and optional API keys before first Settings save.

## Environment reference

| Variable | Purpose |
|----------|---------|
| `LLM_PROVIDER` | `local`, `openai`, `gemini`, `groq`, `openrouter`, `cerebras`, `cursor`, `custom` |
| `LLM_BASE_URL` | OpenAI-compatible endpoint (auto-set for presets except local/custom) |
| `LLM_MODEL` | Model id for the active provider |
| `LLM_CONTEXT` | Context window size hint (default `131072`) |
| `LLM_SLOTS_ENABLED` | Parallel slot mode for local servers (`true` / `false`) |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, … | Provider-specific keys (see table above) |
| `LLM_API_KEY` | Generic fallback key |
| `WORKSPACE_DIR` | Agent + App Builder file root |
| `DATABASE_PATH` | SQLite DB (default `data/jarvis.db`) |
| `PORT` | Server listen port (5173) |
| `SEARXNG_*` | Web search backend (see `.env.example`) |

See `.env.example` for research, brain, context, and agent tuning options.

## Backend API

| Area | Routes |
|------|--------|
| Health | `GET /api/health` |
| Settings | `/api/settings`, `/api/settings/llm/*` |
| Conversations | `/api/conversations/*` |
| Workspace | `/api/workspace/*` |
| Chat | `POST /api/chat`, `POST /api/chat/stream` (SSE) |
| User apps | `/api/user-apps/*` (list, publish, serve, data, jobs, SDK) |
| Brain | `/api/memories`, `/api/skills`, `/api/failures` |
| Research | `/api/research/*` |
| Evolution | `/api/evolution/*` |
| Shell | `/api/shell/*` |

Server logic lives in `src/lib/server/`; route handlers in `src/lib/server/handlers/`; thin `+server.ts` files in `src/routes/api/`.

## Browser app

- `visionos://*` — internal pages in the in-app iframe panel
- `https://*` — **Tauri**: real Chromium `WebviewWindow` | **Web**: system tab

## Project structure

```
visionos/
├── apps/_template/          # Sandbox, schema, and service app templates
├── data/                    # SQLite DB, transcripts (created at runtime)
├── src/
│   ├── routes/api/          # SvelteKit API routes
│   ├── lib/server/          # Jarvis backend + userApps/
│   ├── lib/platform/        # Tauri detection + browser launcher
│   └── lib/components/      # OS shell + built-in/user apps
├── src-tauri/               # Rust / Tauri desktop shell
├── static/visionos-sdk.js   # SDK for sandbox user apps
└── build/                   # adapter-node output (after npm run build)
```

## Creating your first app

1. Open **Chat** from the Start menu.
2. Switch composer mode to **App Builder** (or open **My Apps → + Add App**).
3. Describe the app: *"A pomodoro timer with start/pause and a 25-minute default."*
4. Watch the activity panel as the agent builds and publishes.
5. Find it under **My Apps** and launch it from the desktop or Start menu.

Run the user-apps test suite: `npm run test:user-apps`