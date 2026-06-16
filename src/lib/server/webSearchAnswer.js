import { config } from "./config.js";
import { usedWebSearch } from "./codingResearch.js";
import { getTurnIntent } from "./turnIntent.js";
import { requiresAgentTaskPlan } from "./knowledgeQA.js";
import { webSearchCountThisTurn, getEnginesUsedThisTurn } from "./webSearchPolicy.js";
import { getWebSearchSourcesFromEvents } from "./webSearchCitations.js";
import { suggestAlternateEngines } from "./searxngEngines.js";

/** Reply handed work back to Jan after web_search already ran. */
const DEFER_AFTER_SEARCH_PATTERNS = [
  /\b(recommend|suggest) (?:checking|visiting|going to|that you check)\b/i,
  /\bcheck (?:that|the) link\b/i,
  /\bvisit (?:the|that) (?:link|page|url|site)\b/i,
  /\bgo to (?:the|that) (?:link|page|site)\b/i,
  /\bfor the most (?:up-to-date|accurate|current)\b/i,
  /\b(?:snippets?|results?) (?:do not|don't|does not|doesn't) contain\b/i,
  /\b(?:results?|search) (?:returned|are) (?:not|aren't) providing\b/i,
  /\b(?:not|aren't) providing the requested facts\b/i,
  /\bI am still unable to retrieve\b/i,
  /\b(?:unable|cannot) to retrieve the specific\b/i,
  /\bI (?:cannot|can't) (?:determine|find|see|provide|answer|extract) the specific\b/i,
  /\bI (?:cannot|can't) answer your question at this moment\b/i,
  /\b(?:must|have to) inform you that I (?:cannot|can't)\b/i,
  /\bwithout (?:accessing|visiting|checking) (?:the|that)\b/i,
  /\byou (?:can|should|may) (?:check|find|see) (?:that|the|it)\b/i,
];

const FACTUAL_QUESTION =
  /\b(what|who|when|where|why|how|which|latest|current|version|release date|population|price|what's new)\b/i;

/**
 * @param {string} content
 * @returns {Array<{ title?: string, url?: string, snippet?: string, pageContent?: string }>}
 */
export function parseWebSearchResultsFromContent(content) {
  const text = String(content ?? "");
  if (!text || /^Web search failed/i.test(text)) return [];
  if (/^Web search limit/i.test(text)) return [];
  if (/^\[Cached — same query already searched/i.test(text)) return [];

  const marker = "RESULTS JSON:\n";
  const markerIdx = text.indexOf(marker);
  if (markerIdx >= 0) {
    try {
      const parsed = JSON.parse(text.slice(markerIdx + marker.length).trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }

  const jsonStart = text.indexOf("[");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
  }

  return [];
}

/**
 * @param {Array<{ type?: string, name?: string, content?: string }>} toolEvents
 */
export function parseWebSearchResultsFromEvents(toolEvents) {
  const hits = (toolEvents ?? []).filter(
    (e) =>
      e.type === "tool_result" &&
      e.name === "web_search" &&
      e.content &&
      !/^Web search failed/i.test(String(e.content)) &&
      !/^Web search limit/i.test(String(e.content)) &&
      !/^\[Cached — same query already searched/i.test(String(e.content)),
  );

  const merged = [];
  for (const hit of hits) {
    merged.push(...parseWebSearchResultsFromContent(hit.content));
  }
  return merged;
}

export function searchResultsHaveExtractableContent(results) {
  if (!Array.isArray(results) || !results.length) return false;

  for (const row of results) {
    const page = String(row?.pageContent ?? "").trim();
    if (
      page.length >= 60 &&
      !/^\[Page fetch failed/i.test(page) &&
      !/^Unsupported content-type/i.test(page)
    ) {
      return true;
    }
    const snippet = String(row?.snippet ?? "").trim();
    if (snippet.length >= 40) return true;
    const title = String(row?.title ?? "").trim();
    const url = String(row?.url ?? row?.link ?? "").trim();
    if (title.length >= 8 && url.startsWith("http") && snippet.length >= 15) {
      return true;
    }
  }

  return false;
}

/** @param {Array<{ title?: string, url?: string, snippet?: string, pageContent?: string }>} results */
export function formatSearchResultsExcerpt(results, { maxItems = 5 } = {}) {
  if (!Array.isArray(results) || !results.length) return "";

  return results
    .slice(0, maxItems)
    .map((row, index) => {
      const title = String(row?.title ?? "Source").trim() || "Source";
      const url = String(row?.url ?? row?.link ?? "").trim();
      const snippet = String(row?.snippet ?? "").trim();
      const page = String(row?.pageContent ?? "").trim();
      const parts = [`${index + 1}. ${title}`];
      if (url) parts.push(url);
      if (snippet) parts.push(`Snippet: ${snippet.slice(0, 320)}`);
      if (
        page &&
        page.length >= 40 &&
        !/^\[Page fetch failed/i.test(page) &&
        !/^Unsupported content-type/i.test(page)
      ) {
        parts.push(`Page: ${page.slice(0, 500)}`);
      }
      return parts.join(" — ");
    })
    .join("\n");
}

/** True when the turn's web_search returned actionable content (live or brain recall). */
export function webSearchResultsWereUseful(toolEvents) {
  if (!usedWebSearch(toolEvents)) return false;

  const brainHit = toolEvents.find(
    (e) =>
      e.type === "tool_result" &&
      e.name === "web_search" &&
      /BRAIN RECALL — answer loaded from saved memory/i.test(String(e.content ?? "")),
  );
  if (brainHit) {
    const results = parseWebSearchResultsFromContent(brainHit.content);
    return searchResultsHaveExtractableContent(results);
  }

  const results = parseWebSearchResultsFromEvents(toolEvents);
  return searchResultsHaveExtractableContent(results);
}

export function replyDefersAfterWebSearch(reply) {
  const text = String(reply ?? "");
  if (!text.trim()) return false;
  return DEFER_AFTER_SEARCH_PATTERNS.some((p) => p.test(text));
}

export function webSearchFollowUpNudgeAlreadySent(llmMessages) {
  return (llmMessages ?? []).slice(-10).some(
    (m) =>
      m.role === "user" &&
      /WEB SEARCH — (EXTRACT|RETRY|BEST EFFORT|ANSWER NOW)/i.test(String(m.content ?? "")),
  );
}

function canRetryWebSearch(threadId) {
  return webSearchCountThisTurn(threadId) < config.searxng.maxPerTurn;
}

export function isWebSearchLimitReached(threadId) {
  return webSearchCountThisTurn(threadId) >= config.searxng.maxPerTurn;
}

/**
 * @param {string} userMessage
 * @param {string} reply
 * @param {Array} toolEvents
 * @param {{ llmMessages?: Array }} conversation
 * @param {string} threadId
 */
export function shouldForceWebSearchFollowUp(
  userMessage,
  reply,
  toolEvents,
  conversation,
  threadId,
) {
  if (!usedWebSearch(toolEvents)) return false;
  if (requiresAgentTaskPlan(userMessage)) return false;

  const intent = getTurnIntent(threadId);
  if (intent?.profile === "code") return false;

  if (webSearchFollowUpNudgeAlreadySent(conversation?.llmMessages)) return false;

  const results = parseWebSearchResultsFromEvents(toolEvents);
  const hasExtractable = searchResultsHaveExtractableContent(results);
  const deferred = replyDefersAfterWebSearch(reply);
  const factual = FACTUAL_QUESTION.test(String(userMessage ?? ""));

  if (deferred) return true;

  if (factual && results.length > 0 && !hasExtractable && canRetryWebSearch(threadId)) {
    return true;
  }

  if (factual && results.length > 0 && isWebSearchLimitReached(threadId)) {
    return true;
  }

  return false;
}

/**
 * @param {string} userMessage
 * @param {Array} toolEvents
 * @param {string} threadId
 */
export function buildWebSearchFollowUpNudge(userMessage, toolEvents, threadId) {
  const results = parseWebSearchResultsFromEvents(toolEvents);
  const hasExtractable = searchResultsHaveExtractableContent(results);
  const sources = getWebSearchSourcesFromEvents(toolEvents);
  const excerpt = formatSearchResultsExcerpt(results);
  const sourceHint = sources[0]?.url
    ? `\nPrimary source: ${sources[0].url}`
    : "";

  if (results.length > 0 && (hasExtractable || isWebSearchLimitReached(threadId))) {
    return (
      "WEB SEARCH — ANSWER NOW: You already searched — do NOT call web_search again this turn. " +
      "Extract facts from these results and answer Master Jan in plain text with source URLs.\n\n" +
      (excerpt || "(no excerpt)") +
      "\n\nCite the URL for every fact. Never say you cannot answer when snippets or pageContent exist." +
      sourceHint
    );
  }

  if (hasExtractable) {
    return (
      "WEB SEARCH — EXTRACT ANSWER: Search results include pageContent or substantive snippets. " +
      "Read them and answer Master Jan's question with specific facts. " +
      "Cite the source URL with each fact. Do not tell him to check a link himself.\n\n" +
      (excerpt || "") +
      sourceHint
    );
  }

  if (canRetryWebSearch(threadId)) {
    const topic = String(userMessage ?? "").trim().slice(0, 120);
    const used = getEnginesUsedThisTurn(threadId);
    const alternate = suggestAlternateEngines(threadId);
    const engineHint =
      alternate && used.length > 0
        ? ` Use engines: ${alternate} (already used: ${used.join(", ")}).`
        : alternate
          ? ` Use engines: ${alternate}.`
          : "";
    return (
      "WEB SEARCH — RETRY: Results lacked extractable facts. " +
      `Call web_search once more with a narrower query about: ${topic} ` +
      '(add "latest stable version", "release date", or site:official-domain).' +
      engineHint +
      " Then answer from pageContent — do not defer to Jan." +
      sourceHint
    );
  }

  return (
    "WEB SEARCH — BEST EFFORT: Search budget used — do NOT call web_search again. " +
    "Answer from every snippet and pageContent below with source URLs.\n\n" +
    (excerpt || "(no stored results)") +
    sourceHint
  );
}
