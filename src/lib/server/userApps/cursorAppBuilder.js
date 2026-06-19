import { config } from "../config.js";
import { mentionsUserAppCreation } from "./userAppGuidance.js";
import { buildAppRegistrationBlock } from "./userAppGuidance.js";
import { isAppBuilderComposerMode } from "../composerMode.js";

export {
  detectAppSourceFromToolEvents,
  wasAppRegisteredInToolEvents,
  parsePublishSlugFromShellCommand,
} from "./register.js";

export function shouldUseCursorAppBuilder(message, composerMode, askMode = false) {
  if (askMode) return false;
  if (isAppBuilderComposerMode(composerMode)) return true;
  return mentionsUserAppCreation(message);
}

export function buildCursorAppBuilderPrefix(_message) {
  const workspace = config.workspaceDir;
  const apiPort = config.port;

  return `[VisionOS App Builder]

You are building an app that runs INSIDE VisionOS (Start menu → My Apps), not as a separate localhost server.

Naming — you choose (required before you finish):
1. Pick a short lowercase slug for the folder and manifest id (2–4 words, hyphenated).
2. Pick a short display name for visionos.app.json (2–4 words, title case).
3. NEVER use the user's raw sentence as id or name.
   Good: slug spreadsheet-editor, name "Spreadsheet Editor"
   Bad: slug i-need-an-app-that-can-open-and-edit-spreadsheet

Create under workspace/apps/<your-slug>/:
- visionos.app.json (type: sandbox, entry: index.html) — include your chosen id and name
- index.html (+ css/js assets in same folder)

Example visionos.app.json shape:
{"id":"<your-slug>","name":"<Your App Name>","icon":"📦","type":"sandbox","entry":"index.html","permissions":["storage"]}

${buildAppRegistrationBlock({ apiPort, forCursor: true })}

Other rules:
- Do NOT run npx serve, http-server, vite dev, or bind random ports.
- Do NOT tell the user to open http://localhost:… — VisionOS serves the app after registration.

Workspace root: ${workspace}`;
}
