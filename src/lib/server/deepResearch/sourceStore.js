import { newId, markUrlSeen, hasUrlSeen, domainFromUrl } from "./sessionMemory.js";
import { classifySourceType, scoreReliability } from "./sourceScorer.js";

/**
 * @param {ReturnType<typeof import('./sessionMemory.js').createSessionMemory>} memory
 * @param {{
 *   hit: { title?: string, link?: string, url?: string, snippet?: string, publishedDate?: string, author?: string },
 *   query: string,
 *   category: string,
 *   sessionId: string,
 *   maxSources: number,
 * }} ctx
 * @returns {object | null}
 */
export function addSourceFromHit(memory, { hit, query, category, sessionId, maxSources }) {
  const url = String(hit.url ?? hit.link ?? "").trim();
  if (!url || hasUrlSeen(memory, url)) return null;
  if (memory.sources.length >= maxSources) return null;

  markUrlSeen(memory, url);
  const sourceType = classifySourceType(url, hit.title ?? "");
  const reliabilityScore = scoreReliability(url, sourceType);

  const source = {
    id: newId("src"),
    sessionId,
    url,
    title: String(hit.title ?? url).slice(0, 300),
    snippet: String(hit.snippet ?? "").slice(0, 800),
    author: hit.author ? String(hit.author).slice(0, 120) : undefined,
    publishedAt: hit.publishedDate ? String(hit.publishedDate).slice(0, 40) : undefined,
    domain: domainFromUrl(url),
    sourceType,
    reliabilityScore,
    confidenceScore: 0.5,
    fetchStatus: "snippet",
    extractedClaims: [],
    searchedVia: query,
    category,
    visitedAt: Date.now(),
  };

  memory.sources.push(source);
  return source;
}

/**
 * @param {object} source
 * @param {string} pageText
 */
export function attachPageText(source, pageText) {
  source.pageText = String(pageText ?? "").slice(0, 6000);
  source.fetchStatus = "fetched";
  source.confidenceScore = Math.min(1, source.confidenceScore + 0.2);
}

export function domainDiversityScore(memory, url) {
  const domain = domainFromUrl(url);
  if (!domain) return 1;
  const count = memory.domainsSeen.get(domain) ?? 0;
  return 1 / (1 + count);
}
