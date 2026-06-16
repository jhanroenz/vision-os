/** @typedef {'quick' | 'standard' | 'deep' | 'exhaustive'} ResearchTier */

export const RESEARCH_TIERS = {
  quick: {
    maxSearches: 3,
    maxSources: 5,
    maxPageFetches: 5,
    maxIterations: 2,
    maxImages: 3,
    maxVideos: 1,
    numResults: 8,
  },
  standard: {
    maxSearches: 8,
    maxSources: 20,
    maxPageFetches: 20,
    maxIterations: 4,
    maxImages: 12,
    maxVideos: 4,
    numResults: 12,
  },
  deep: {
    maxSearches: 20,
    maxSources: 40,
    maxPageFetches: 40,
    maxIterations: 8,
    maxImages: 25,
    maxVideos: 10,
    numResults: 15,
  },
  exhaustive: {
    maxSearches: 50,
    maxSources: 100,
    maxPageFetches: 80,
    maxIterations: 15,
    maxImages: 50,
    maxVideos: 20,
    numResults: 20,
  },
};

export function normalizeResearchTier(tier) {
  const raw = String(tier ?? "standard").trim().toLowerCase();
  return Object.hasOwn(RESEARCH_TIERS, raw) ? /** @type {ResearchTier} */ (raw) : "standard";
}

export function getTierBudget(tier) {
  return RESEARCH_TIERS[normalizeResearchTier(tier)];
}
