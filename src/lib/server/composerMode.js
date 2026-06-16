/** Composer modes from the client dropdown. */
export const COMPOSER_MODES = ["chat", "ask", "research", "command"];

export function normalizeComposerMode(mode) {
  const raw = String(mode ?? "chat").trim().toLowerCase();
  return COMPOSER_MODES.includes(raw) ? raw : "chat";
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
