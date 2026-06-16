import { config } from "./config.js";
import { getEnginesUsedThisTurn } from "./webSearchPolicy.js";

/** Common SearXNG engines when use_default_settings is enabled. */
export const DEFAULT_ALLOWED_ENGINES = [
  "google",
  "bing",
  "brave",
  "duckduckgo",
  "startpage",
  "qwant",
  "mojeek",
];

const ENGINE_HINTS = {
  google: "broad general web",
  bing: "general web, Microsoft index",
  brave: "privacy-focused general web",
  duckduckgo: "alternative general index",
  startpage: "Google results via proxy",
  qwant: "EU-focused general web",
  mojeek: "independent crawler",
};

/**
 * @param {string | string[] | null | undefined} value
 * @returns {string[]}
 */
export function parseEngineList(value) {
  if (value == null || value === "") return [];

  const raw = Array.isArray(value) ? value.join(",") : String(value);
  const seen = new Set();
  const out = [];

  for (const part of raw.split(/[,;|\s]+/)) {
    const name = part.trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }

  return out;
}

/** @returns {string[]} */
export function getAllowedEngines() {
  const fromConfig = config.searxng.allowedEngines;
  return fromConfig?.length ? fromConfig : DEFAULT_ALLOWED_ENGINES;
}

/**
 * Build guidance for the web_search tool description.
 * @returns {string}
 */
export function buildEngineSelectionGuide() {
  const allowed = getAllowedEngines();
  const lines = allowed.map((name) => {
    const hint = ENGINE_HINTS[name] ?? "search engine";
    return `${name} (${hint})`;
  });

  return (
    "Pick one or more comma-separated SearXNG engines via the optional `engines` argument " +
    "to vary results and avoid repeated blocks. Rotate engines when retrying a weak search. " +
    `Allowed engines: ${lines.join("; ")}.`
  );
}

/**
 * Suggest engines not used yet this turn (or next in rotation).
 * @param {string} [threadId]
 * @returns {string | null} comma-separated engine list
 */
export function suggestAlternateEngines(threadId) {
  const pool = getAllowedEngines();
  if (!pool.length) return null;

  const used = new Set(getEnginesUsedThisTurn(threadId));
  const unused = pool.filter((e) => !used.has(e));

  if (unused.length >= 2) {
    return `${unused[0]},${unused[1]}`;
  }
  if (unused.length === 1) {
    return unused[0];
  }

  const idx = used.size % pool.length;
  const rotated = pool.slice(idx, idx + 2);
  if (rotated.length === 2) return rotated.join(",");
  return pool[idx] ?? pool[0] ?? null;
}

export function pickDefaultSearchEngine(threadId) {
  const pool = getAllowedEngines();
  if (!pool.length) return undefined;

  const used = new Set(getEnginesUsedThisTurn(threadId));
  const next = pool.find((e) => !used.has(e));
  return next ?? pool[used.size % pool.length];
}

/**
 * Pick a rotating set of SearXNG engines for deep-research searches.
 * Prefers engines not yet used this session, then fills by rotation.
 * @param {{ searchesPerformed?: number, enginesUsed?: string[] }} memory
 * @returns {string | undefined} comma-separated engine names
 */
export function planResearchSearchEngines(memory) {
  const pool = getAllowedEngines();
  if (!pool.length) return undefined;

  const count = Math.min(
    Math.max(1, config.deepResearch?.enginesPerSearch ?? 2),
    pool.length,
  );
  const sessionUsed = new Set(memory?.enginesUsed ?? []);
  const picked = [];

  for (const engine of pool) {
    if (picked.length >= count) break;
    if (!sessionUsed.has(engine)) picked.push(engine);
  }

  let idx = (memory?.searchesPerformed ?? 0) % pool.length;
  while (picked.length < count) {
    const engine = pool[idx % pool.length];
    if (!picked.includes(engine)) picked.push(engine);
    idx += 1;
  }

  if (!memory.enginesUsed) memory.enginesUsed = [];
  for (const engine of picked) {
    if (!memory.enginesUsed.includes(engine)) {
      memory.enginesUsed.push(engine);
    }
  }

  return resolveWebSearchEngines({ requested: picked.join(",") }).engines;
}

/**
 * Pick one alternate engine not in the last research search request.
 * @param {{ searchesPerformed?: number, enginesUsed?: string[] }} memory
 * @param {string | undefined} alreadyUsed
 * @returns {string | undefined}
 */
export function pickSupplementalResearchEngine(memory, alreadyUsed) {
  const pool = getAllowedEngines();
  const usedSet = new Set(parseEngineList(alreadyUsed));
  const candidates = pool.filter((e) => !usedSet.has(e));
  if (!candidates.length) return undefined;

  const idx = (memory?.searchesPerformed ?? 0) % candidates.length;
  return resolveWebSearchEngines({ requested: candidates[idx] }).engines;
}

/**
 * Resolve which engines to pass to SearXNG for a web_search call.
 * @param {{ requested?: string | string[], threadId?: string }} [options]
 * @returns {{ engines?: string, invalid?: string[], note?: string, error?: string }}
 */
export function resolveWebSearchEngines({ requested, threadId } = {}) {
  const allowed = getAllowedEngines();
  const allowedSet = new Set(allowed);
  const requestedList = parseEngineList(requested);

  if (requestedList.length > 0) {
    const valid = requestedList.filter((e) => allowedSet.has(e));
    const invalid = requestedList.filter((e) => !allowedSet.has(e));

    if (valid.length === 0) {
      return {
        error:
          `Invalid engines: ${invalid.join(", ")}. ` +
          `Pick from allowed engines: ${allowed.join(", ")}.`,
      };
    }

    return {
      engines: valid.join(","),
      invalid: invalid.length ? invalid : undefined,
      note:
        invalid.length > 0
          ? `Ignored invalid engines: ${invalid.join(", ")}.`
          : undefined,
    };
  }

  const fixed = config.searxng.defaultEngines;
  if (fixed && config.searxng.useFixedEnginesWhenUnspecified) {
    return { engines: fixed };
  }

  const fallback = pickDefaultSearchEngine(threadId);
  if (fallback) {
    return { engines: fallback };
  }

  return { engines: undefined };
}

/**
 * Prefix for tool output noting which engines were queried.
 * @param {string | undefined} engines
 * @param {Array<{ engine?: string }>} [hits]
 * @returns {string}
 */
export function formatEnginesUsedHeader(engines, hits = []) {
  const fromHits = [
    ...new Set(
      hits.map((h) => h.engine).filter(Boolean).map((e) => String(e).toLowerCase()),
    ),
  ];

  const requested = parseEngineList(engines);
  const label =
    fromHits.length > 0
      ? fromHits.join(", ")
      : requested.length > 0
        ? requested.join(", ")
        : "SearXNG default pool";

  return `Engines used: ${label}\n`;
}
