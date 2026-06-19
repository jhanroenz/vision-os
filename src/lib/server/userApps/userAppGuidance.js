import { config } from "../config.js";
import { resolveDataDir } from "../paths.js";

const WORKSPACE_APPS = "{workspace}/apps/<slug>/";
const PUBLISHED_APPS = "{dataDir}/apps/<slug>/";

export function buildAppRegistrationBlock({ apiPort = config.port, forCursor = false } = {}) {
  const publishUrl = `http://127.0.0.1:${apiPort}/api/user-apps/<slug>/publish`;
  if (forCursor) {
    return `REGISTER IN VISIONOS (mandatory final step — do not skip):
After apps/<slug>/ has visionos.app.json and index.html, register the app so it appears in My Apps:
  curl -s -X POST "${publishUrl.replace("<slug>", "<your-slug>")}"
Replace <your-slug> with your manifest id. Do not tell the user the app is installed until this succeeds.`;
  }
  return `REGISTER IN VISIONOS (mandatory final step):
After apps/<slug>/ is complete, call register_user_app with id=<slug> (or publish_user_app).
Do not tell the user the app is installed until register_user_app succeeds.
API equivalent (Cursor/shell): curl -s -X POST "${publishUrl.replace("<slug>", "<slug>")}"`;
}

export const USER_APP_MANIFEST_EXAMPLE = {
  id: "my-app",
  name: "My App",
  icon: "📦",
  type: "sandbox",
  entry: "index.html",
  defaultWidth: 640,
  defaultHeight: 480,
  launcher: true,
  permissions: ["storage", "agent:prompt"],
};

export const USER_APP_SCHEMA_EXAMPLE = {
  id: "my-dashboard",
  name: "My Dashboard",
  icon: "📊",
  type: "schema",
  schema: "schema.json",
  permissions: ["storage"],
};

export function buildUserAppGuidanceBlock() {
  const workspace = config.workspaceDir;
  const dataDir = resolveDataDir();

  return `VisionOS User Apps — App Builder playbook

Architecture rules:
- User apps are NEVER registered in src/lib/apps/registry.ts and never require a VisionOS rebuild.
- Staging path: ${workspace}/apps/<slug>/
- Published path: ${dataDir}/apps/<slug>/
- Runtime registry id: user:<slug>
- App types:
  - sandbox — custom HTML/JS UI (iframe + VisionOS SDK via same-origin serve URL)
  - schema — forms/lists/dashboards via schema.json (no heavy JS)
  - service — background jobs/automation; UI optional

Mandatory workflow:
1. YOU choose a short slug (lowercase, hyphenated) and display name (2–4 words) for visionos.app.json — never use the user's full sentence.
   Example: "I need an app that can edit spreadsheets" → slug spreadsheet-editor, name Spreadsheet Editor.
2. create_user_app with that slug and name, or import_user_app to wrap an existing index.html project (or list_user_apps to confirm a draft).
3. Implement ONLY under workspace/apps/<slug>/.
4. Set visionos.app.json permissions minimally (storage, agent:prompt, jobs only if needed).
5. Sandbox: use visionOS.storage SDK — no direct fetch to arbitrary URLs in v1.
6. Schema: edit schema.json; seed app_data via set_app_data when needed.
7. Validate manifest fields and entry/schema files exist.
8. register_user_app (or publish_user_app) — required before claiming the app is installed.
9. Tell Master Jan to open from Start menu or App Manager.

${buildAppRegistrationBlock()}

Hard prohibitions:
- Do not edit built-in Svelte apps under src/lib/components/apps/.
- Do not instruct Master Jan to rebuild Tauri/npm for app installation.
- Do not use run_bash with serve, http-server, vite dev, or random ports to host apps — use register_user_app instead.
- Do not use run_bash for app logic that belongs in app_jobs or backend SDK.
- Do not request network permission; proxy via backend if needed later.

Templates (repo):
- apps/_template/sandbox/
- apps/_template/schema/
- apps/_template/service/

Manifest example:
${JSON.stringify(USER_APP_MANIFEST_EXAMPLE, null, 2)}

Schema app manifest example:
${JSON.stringify(USER_APP_SCHEMA_EXAMPLE, null, 2)}

After publish, summarize: app name, type, how to open, permissions granted, and data persistence (SDK storage vs app_data).`;
}

export function mentionsUserAppCreation(message) {
  const text = String(message ?? "");
  return (
    /\b(create|build|make|scaffold)\b.*\b(app|application|game)\b/i.test(text) ||
    /\b(app|application|game)\b.*\b(for\s+)?visionos\b/i.test(text) ||
    /\bvisionos\b.*\b(app|application|game)\b/i.test(text) ||
    /\b(install|launch|open)\b.*\b(app|game)\b.*\bvisionos\b/i.test(text)
  );
}
