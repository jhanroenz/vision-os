import { newId } from "./sessionMemory.js";

/**
 * @param {object} source
 * @returns {Array<{ id: string, sourceId: string, text: string, quote?: string, confidence: number }>}
 */
export function extractClaimsFromSource(source) {
  const body = [
    source.snippet ?? "",
    source.pageText ?? "",
  ]
    .join("\n")
    .trim();

  if (!body || body.length < 24) return [];

  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 500);

  const claims = sentences.slice(0, 6).map((text) => ({
    id: newId("claim"),
    sourceId: source.id,
    text,
    quote: text.slice(0, 240),
    confidence: Math.min(0.85, 0.45 + source.reliabilityScore * 0.4),
  }));

  source.extractedClaims = claims;
  source.confidenceScore = claims.length
    ? claims.reduce((a, c) => a + c.confidence, 0) / claims.length
    : source.confidenceScore;

  return claims;
}

/**
 * @param {Array<{ id: string, sourceId: string, text: string }>} allClaims
 */
export function detectSimpleContradictions(allClaims) {
  const contradictions = [];
  const versionClaims = allClaims.filter((c) =>
    /\b(version|release|stable|beta|v?\d+\.\d+)\b/i.test(c.text),
  );

  const versions = new Map();
  for (const claim of versionClaims) {
    const match = claim.text.match(/\b(v?\d+\.\d+(?:\.\d+)?)\b/i);
    if (!match) continue;
    const v = match[1].toLowerCase();
    if (!versions.has(v)) versions.set(v, []);
    versions.get(v).push(claim);
  }

  if (versions.size > 1) {
    const entries = [...versions.entries()];
    contradictions.push({
      id: newId("contra"),
      topic: "Version numbers across sources",
      claims: entries.flatMap(([, list]) =>
        list.slice(0, 2).map((c) => ({
          claimId: c.id,
          sourceId: c.sourceId,
          text: c.text.slice(0, 200),
        })),
      ),
      analysis:
        "Multiple distinct version numbers appear across sources — verify against official release notes.",
    });
  }

  return contradictions;
}
