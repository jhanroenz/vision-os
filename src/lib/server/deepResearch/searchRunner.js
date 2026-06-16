import { config } from "../config.js";
import { searchSearxngRich } from "../searxngSearch.js";
import {
  planResearchSearchEngines,
  pickSupplementalResearchEngine,
} from "../searxngEngines.js";
import {
  hasQueryExecuted,
  markQueryExecuted,
} from "./sessionMemory.js";
import { addSourceFromHit } from "./sourceStore.js";
import { harvestMediaFromSearchHit } from "./mediaHarvester.js";

async function collectHits(memory, query, category, sessionId, budget, engines) {
  const hits = await searchSearxngRich(query, {
    apiBase: config.searxng.apiBase,
    params: {
      numResults: budget.numResults,
      categories: category || config.searxng.categories,
      safesearch: config.searxng.safesearch,
      ...(engines ? { engines } : {}),
      ...(config.searxng.language ? { language: config.searxng.language } : {}),
    },
    headers: config.searxng.headers,
    timeoutMs: config.deepResearch.searchTimeoutMs,
  });

  const sourcesAdded = [];
  const mediaAdded = [];

  for (const hit of hits) {
    const source = addSourceFromHit(memory, {
      hit,
      query,
      category,
      sessionId,
      maxSources: budget.maxSources,
    });
    if (source) sourcesAdded.push(source);

    const media = harvestMediaFromSearchHit(memory, hit, budget);
    mediaAdded.push(...media);
  }

  return { hits, sourcesAdded, mediaAdded };
}

/**
 * @param {{
 *   memory: ReturnType<typeof import('./sessionMemory.js').createSessionMemory>,
 *   query: string,
 *   category: string,
 *   sessionId: string,
 *   budget: import('./tiers.js').RESEARCH_TIERS.standard,
 * }} ctx
 */
export async function runResearchSearch(ctx) {
  const { memory, query, category, sessionId, budget } = ctx;

  if (hasQueryExecuted(memory, query)) {
    return { skipped: true, reason: "duplicate_query", hits: [], sourcesAdded: [] };
  }
  if (memory.searchesPerformed >= budget.maxSearches) {
    return { skipped: true, reason: "search_budget", hits: [], sourcesAdded: [] };
  }

  markQueryExecuted(memory, query);

  const engines = planResearchSearchEngines(memory);
  let { hits, sourcesAdded, mediaAdded } = await collectHits(
    memory,
    query,
    category,
    sessionId,
    budget,
    engines,
  );

  if (
    config.deepResearch.supplementalEngineSearch &&
    sourcesAdded.length < 2
  ) {
    const supplemental = pickSupplementalResearchEngine(memory, engines);
    if (supplemental) {
      const extra = await collectHits(
        memory,
        query,
        category,
        sessionId,
        budget,
        supplemental,
      );
      hits = [...hits, ...extra.hits];
      sourcesAdded = [...sourcesAdded, ...extra.sourcesAdded];
      mediaAdded = [...mediaAdded, ...extra.mediaAdded];
    }
  }

  return {
    skipped: false,
    hits,
    sourcesAdded,
    mediaAdded,
    engines,
  };
}

export { planResearchSearchEngines };