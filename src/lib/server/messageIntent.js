/** Persona, identity, or core-memory instructions — not workspace coding work. */
const PERSONA_INSTRUCTION_PATTERNS = [
  /\byou are\b/i,
  /\byour (?:role|identity|mission|directive|primary directive|purpose)\b/i,
  /\b(?:core memory|permanent identity|backstory|persona|system prompt)\b/i,
  /\btreat (?:this|it) as foundational\b/i,
  /\bfrom (?:now on|that moment forward)\b/i,
  /\bunless explicitly instructed otherwise\b/i,
  /\b(?:always|never) (?:follow|respond|act)\b/i,
];

/**
 * Long-form instructions to adopt identity or save context — not "build my app".
 * @param {string} message
 */
export function isPersonaOrMemoryInstruction(message) {
  const text = String(message ?? "").trim();
  if (text.length < 80) return false;

  let signals = 0;
  for (const pattern of PERSONA_INSTRUCTION_PATTERNS) {
    if (pattern.test(text)) signals++;
  }
  if (/\bcore memory\b/i.test(text)) signals += 2;
  if (/\bremember\b/i.test(text) && /\b(?:this|it|identity|backstory)\b/i.test(text)) {
    signals++;
  }

  return signals >= 2;
}

/**
 * Explicit ask to persist context — narrower than persona blocks.
 * @param {string} message
 */
export function isMemorySaveRequest(message) {
  const text = String(message ?? "").trim();
  return (
    /\b(?:save|store|remember)\b.{0,40}\b(?:brain|memory|core memory)\b/i.test(text) ||
    /\b(?:brain|memory|core memory)\b.{0,40}\b(?:save|store|remember)\b/i.test(text) ||
    (/\bcore memory\b/i.test(text) && /\b(?:permanent|foundational|part of your)\b/i.test(text))
  );
}
