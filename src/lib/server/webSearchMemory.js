import { config } from "./config.js";
import { upsertMemory } from "./coreMemory.js";
import { recallBrain, formatRecallBrainResult } from "./brainRecall.js";
import { getActiveProjectRoot } from "./workspace.js";
import { usedWebSearch, userOptedOutOfWebResearch } from "./codingResearch.js";
import { getWebSearchSourcesFromEvents } from "./webSearchCitations.js";
import { formatWebSearchResultForAgent } from "./webSearchCitations.js";
import {
  replyDefersAfterWebSearch,
  parseWebSearchResultsFromEvents,
  searchResultsHaveExtractableContent,
} from "./webSearchAnswer.js";
import { getTurnIntent } from "./turnIntent.js";
import {
  hasSearchIntent,
  needsExternalFacts,
} from "./webSearchEligibility.js";
import { hasCodebaseLookupIntent } from "./knowledgeQA.js";

const preflightByThread = new Map();
const autoSavedKeys = new Set();
const turnUserQuestion = new Map();

function normalizeKey(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function tokenize(text) {
  return normalizeKey(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

function queriesRelate(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length || !tb.length) return false;
  let hits = 0;
  for (const t of ta) {
    if (tb.includes(t)) hits += 1;
  }
  return hits / Math.min(ta.length, tb.length) >= 0.35;
}

export function isWebResearchQuestion(message) {
  const text = String(message ?? "").trim();
  if (!text) return false;
  if (hasCodebaseLookupIntent(text)) return false;
  return (
    hasSearchIntent(text) ||
    /\b(what|who|when|where|which|how many|latest|current|version|release date|population|price)\b/i.test(
      text,
    )
  );
}

export function memoryTitleFromQuestion(message) {
  const text = String(message ?? "")
    .trim()
    .replace(/\?+$/, "")
    .replace(/\s+/g, " ");
  if (!text) return "Web research fact";
  return text.length > 96 ? `${text.slice(0, 93)}…` : text;
}

export function formatBrainAsWebSearchResult(memory, query) {
  const payload = [
    {
      title: memory.title,
      url: `brain://memory/${memory.id}`,
      snippet: String(memory.content ?? "").slice(0, 400),
      pageContent: String(memory.content ?? ""),
      fromBrain: true,
      brainRecallScore: memory.score,
    },
  ];
  return (
    "BRAIN RECALL — answer loaded from saved memory (no live web search).\n" +
    `Recall query: "${query}"\n\n` +
    formatWebSearchResultForAgent(payload)
  );
}

function minRecallScore() {
  return Number(config.searxng.brainRecallMinScore ?? 0.32);
}

const ASKS_SEARCH_PERMISSION =
  /\b(?:would you like me to|shall I|should I|want me to)\b.*\b(?:web_search|search the web)\b/i;

const EMPTY_RECALL_REPLY_PATTERNS = [
  ASKS_SEARCH_PERMISSION,
  /(?:facts?|information|specific.*?)(?:were|was) not present in (?:the retrieved )?memory/i,
  /not present in (?:the retrieved )?memory snippets?/i,
  /(?:memory|brain) (?:did not|didn't|does not|doesn't) contain/i,
  /recall was executed, but/i,
  /searched (?:the )?memory.*(?:not|no) (?:present|found|available)/i,
];

export function userRequestsFreshWebSearch(message) {
  return /\b(?:search the web again|fresh results?|(?:search|look up|check) again|latest online|up-to-date from the web|search the web)\b/i.test(
    String(message ?? ""),
  );
}

/** Skip brain substitution — user wants live lookup or question needs current external facts. */
export function shouldPreferLiveWebSearch(userMessage) {
  const text = String(userMessage ?? "").trim();
  if (!text) return false;
  if (userOptedOutOfWebResearch(text)) return false;
  if (userRequestsFreshWebSearch(text)) return true;
  if (hasSearchIntent(text) && /\b(search|look up|google)\b/i.test(text)) return true;
  return needsExternalFacts(text);
}

/** Saved or recalled memory must include a substantive answer, not a stub or deferral. */
export function memoryHasActionableAnswer(content) {
  const text = String(content ?? "").trim();
  if (text.length < 32) return false;

  const answerMatch = text.match(
    /^Answer:\s*([\s\S]*?)(?:\n\nSources:|\nSources:|$)/im,
  );
  const answerBody = (answerMatch?.[1] ?? text).trim();
  if (answerBody.length < 20) return false;
  if (replyDefersAfterWebSearch(answerBody)) return false;
  if (ASKS_SEARCH_PERMISSION.test(answerBody)) return false;
  if (/\(no URLs captured\)/i.test(text) && answerBody.length < 80) return false;
  if (
    /\b(?:do not|don't|cannot|can't|unable to) (?:have|provide|perform|access)\b/i.test(
      answerBody,
    )
  ) {
    return false;
  }

  return true;
}

function webSearchToolSucceeded(toolEvents) {
  return toolEvents.some((e) => {
    if (e.type !== "tool_result" || e.name !== "web_search") return false;
    const content = String(e.content ?? "");
    if (!content || content.startsWith("Web search failed")) return false;
    if (content.startsWith("Web search limit")) return false;
    if (/BRAIN RECALL — answer loaded from saved memory/i.test(content)) {
      return false;
    }
    return true;
  });
}

export function usedRecallBrain(toolEvents) {
  return toolEvents.some(
    (e) => e.type === "tool_result" && e.name === "recall_brain",
  );
}

/**
 * @returns {Promise<{ id: string, title: string, content: string, score: number } | null>}
 */
export async function findBrainMemoryForQuery(threadId, query) {
  const text = String(query ?? "").trim();
  if (!text) return null;

  const project = getActiveProjectRoot(threadId);
  const result = await recallBrain({
    query: text,
    type: "memory",
    limit: 3,
    project,
  });

  for (const row of result.memories ?? []) {
    if (row.score < minRecallScore()) continue;
    if (!memoryHasActionableAnswer(row.content)) continue;
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      score: row.score,
    };
  }

  return null;
}

export function setBrainSearchPreflight(threadId, userMessage, memoryHit) {
  preflightByThread.set(threadId, {
    userMessage: normalizeKey(userMessage),
    memoryHit,
  });
}

export function getBrainSearchPreflight(threadId) {
  return preflightByThread.get(threadId) ?? null;
}

export function setTurnResearchQuestion(threadId, message) {
  turnUserQuestion.set(threadId, String(message ?? "").trim());
}

export function getTurnResearchQuestion(threadId) {
  return turnUserQuestion.get(threadId) ?? null;
}

export function clearBrainWebSearchState(threadId) {
  preflightByThread.delete(threadId);
  turnUserQuestion.delete(threadId);
  for (const key of [...autoSavedKeys]) {
    if (key.startsWith(`${threadId}:`)) autoSavedKeys.delete(key);
  }
}

/**
 * @returns {Promise<{ formatted: string, memory: object } | null>}
 */
export async function resolveBrainInsteadOfSearch(threadId, query, userMessage) {
  if (config.searxng.brainRecallBeforeSearch === false) return null;
  if (shouldPreferLiveWebSearch(userMessage)) return null;

  const preflight = getBrainSearchPreflight(threadId);
  if (
    preflight?.memoryHit &&
    memoryHasActionableAnswer(preflight.memoryHit.content) &&
    queriesRelate(query, preflight.userMessage)
  ) {
    return {
      memory: preflight.memoryHit,
      formatted: formatBrainAsWebSearchResult(preflight.memoryHit, query),
    };
  }

  if (
    userMessage &&
    preflight?.memoryHit &&
    memoryHasActionableAnswer(preflight.memoryHit.content) &&
    queriesRelate(userMessage, preflight.userMessage)
  ) {
    return {
      memory: preflight.memoryHit,
      formatted: formatBrainAsWebSearchResult(preflight.memoryHit, query),
    };
  }

  const memory = await findBrainMemoryForQuery(threadId, query);
  if (!memory) return null;

  return {
    memory,
    formatted: formatBrainAsWebSearchResult(memory, query),
  };
}

export function buildBrainPreflightBrief(memory, userMessage) {
  const preferLive = shouldPreferLiveWebSearch(userMessage);
  return (
    (preferLive
      ? "BRAIN RECALL — related saved memory (may be stale). Prefer web_search for current facts unless this fully answers the question.\n\n"
      : "BRAIN RECALL — saved answer on file. Use it if complete; otherwise call web_search — do not tell Jan you lack data without searching.\n\n") +
    `[${memory.title}]\n${memory.content}\n\n` +
    `Original question context: ${String(userMessage ?? "").trim()}`
  );
}

/**
 * @returns {Promise<{ id: string, title: string, content: string, score: number } | null>}
 */
export async function preflightBrainForQuestion(threadId, userMessage) {
  if (!isWebResearchQuestion(userMessage)) return null;
  if (userRequestsFreshWebSearch(userMessage)) return null;
  if (shouldPreferLiveWebSearch(userMessage)) return null;
  return findBrainMemoryForQuery(threadId, userMessage);
}

export function buildWebSearchSaveContent(userMessage, reply, toolEvents) {
  const title = memoryTitleFromQuestion(userMessage);
  const sources = getWebSearchSourcesFromEvents(toolEvents);
  const sourceBlock = sources.length
    ? sources.map((s) => `- ${s.title}: ${s.url}`).join("\n")
    : "(no URLs captured)";

  return [
    `Question: ${String(userMessage ?? "").trim()}`,
    "",
    `Answer: ${String(reply ?? "").trim()}`,
    "",
    "Sources:",
    sourceBlock,
  ].join("\n");
}

export function shouldAutoSaveWebSearchAnswer(userMessage, reply, toolEvents) {
  if (config.searxng.autoSaveToBrain === false) return false;
  if (!webSearchToolSucceeded(toolEvents)) return false;
  if (replyDefersAfterWebSearch(reply)) return false;

  const text = String(reply ?? "").trim();
  if (text.length < 48) return false;
  if (ASKS_SEARCH_PERMISSION.test(text)) return false;

  const results = parseWebSearchResultsFromEvents(toolEvents);
  const hasExtractable = searchResultsHaveExtractableContent(results);
  if (!hasExtractable && text.length < 80) return false;

  if (!isWebResearchQuestion(userMessage)) return false;

  const content = buildWebSearchSaveContent(userMessage, reply, toolEvents);
  return memoryHasActionableAnswer(content);
}

export function shouldForceWebSearchAfterEmptyRecall(
  userMessage,
  reply,
  toolEvents,
  threadId,
) {
  if (usedWebSearch(toolEvents)) return false;
  if (getTurnIntent(threadId)?.casualChat) return false;
  if (!isWebResearchQuestion(userMessage)) return false;

  const replyText = String(reply ?? "");
  const emptyRecall = EMPTY_RECALL_REPLY_PATTERNS.some((p) => p.test(replyText));
  if (!emptyRecall) return false;

  return usedRecallBrain(toolEvents) || /searched (?:the )?memory/i.test(replyText);
}

/**
 * @returns {Promise<import("./coreMemory.js").ReturnType<typeof upsertMemory> | null>}
 */
export async function autoSaveWebSearchToBrain({
  threadId,
  userMessage,
  reply,
  toolEvents,
}) {
  if (!shouldAutoSaveWebSearchAnswer(userMessage, reply, toolEvents)) {
    return null;
  }

  const saveKey = `${threadId}:${normalizeKey(userMessage)}`;
  if (autoSavedKeys.has(saveKey)) return null;

  const title = memoryTitleFromQuestion(userMessage);
  const content = buildWebSearchSaveContent(userMessage, reply, toolEvents);

  const project = getActiveProjectRoot(threadId);
  const saved = await upsertMemory({
    title,
    content,
    category: "fact",
    importance: 4,
    project,
    source: "web-search",
    sourceConversationId: threadId,
    enabled: true,
  });

  autoSavedKeys.add(saveKey);
  return saved;
}

export { formatRecallBrainResult };
