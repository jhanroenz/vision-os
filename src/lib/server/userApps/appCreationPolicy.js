import { mentionsUserAppCreation } from "./userAppGuidance.js";

/** Commands that host apps outside VisionOS — blocked during app creation flows. */
export function isExternalAppServerCommand(command) {
  const cmd = String(command ?? "").trim();
  if (!cmd) return false;
  return (
    /\b(npx\s+(--yes\s+)?)?(serve|http-server|live-server)\b/i.test(cmd) ||
    /\bvite\s+(dev|preview)\b/i.test(cmd) ||
    /\bpython\s+-m\s+http\.server\b/i.test(cmd) ||
    /\b(npx\s+)?vite\b/i.test(cmd) ||
    (/\bserve\b/i.test(cmd) && /\b-p\s+\d+\b/i.test(cmd))
  );
}

export function shouldUseVisionOsAppPipeline(threadId, message, getTurnIntent) {
  const intent = getTurnIntent?.(threadId);
  if (intent?.profile === "appBuilder") return true;
  return mentionsUserAppCreation(message);
}

export function externalAppServerBlockMessage() {
  return (
    "Blocked: do not host apps with serve/http-server/vite on a random port.\n" +
    "VisionOS apps must use create_user_app → workspace/apps/<slug>/ → register_user_app.\n" +
    "They launch inside VisionOS from Start menu → My Apps, served at /api/user-apps/<slug>/serve/index.html."
  );
}
