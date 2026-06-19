/** Composer modes from the client dropdown. */
export const COMPOSER_MODES = ["chat", "ask", "research", "command", "appBuilder"];

export function normalizeComposerMode(mode) {
  const raw = String(mode ?? "chat").trim();
  const lower = raw.toLowerCase();
  if (lower === "appbuilder") return "appBuilder";
  if (COMPOSER_MODES.includes(lower)) return lower;
  if (COMPOSER_MODES.includes(raw)) return raw;
  return "chat";
}

export function isAskComposerMode(mode) {
  return normalizeComposerMode(mode) === "ask";
}

export function isResearchComposerMode(mode) {
  return normalizeComposerMode(mode) === "research";
}

export function isCommandComposerMode(mode) {
  return normalizeComposerMode(mode) === "command";
}

export function isAppBuilderComposerMode(mode) {
  return normalizeComposerMode(mode) === "appBuilder";
}
