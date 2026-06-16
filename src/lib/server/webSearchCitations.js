import { usedWebSearch } from "./codingResearch.js";
import { getTurnIntent } from "./turnIntent.js";
import { requiresAgentTaskPlan } from "./knowledgeQA.js";

/**
 * @typedef {{ title: string, url: string }} WebSearchSource
 */

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {unknown} results
 * @returns {WebSearchSource[]}
 */
export function sourcesFromSearchResults(results) {
  if (!Array.isArray(results)) return [];
  return results
    .map((r) => ({
      title: String(r?.title ?? r?.link ?? "Source").trim() || "Source",
      url: String(r?.url ?? r?.link ?? "").trim(),
    }))
    .filter((s) => s.url.startsWith("http"));
}

/**
 * @param {string} content
 * @returns {WebSearchSource[]}
 */
export function parseWebSearchSources(content) {
  const text = String(content ?? "");
  if (!text || /^Web search failed/i.test(text)) return [];

  const jsonStart = text.indexOf("[");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart));
      const fromJson = sourcesFromSearchResults(parsed);
      if (fromJson.length) return fromJson;
    } catch {
      // fall through
    }
  }

  const urls = [...text.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) => m[0]);
  return [...new Set(urls)].map((url) => ({ title: url, url }));
}

/**
 * @param {Array<{ type?: string, name?: string, content?: string }>} toolEvents
 * @returns {WebSearchSource[]}
 */
export function getWebSearchSourcesFromEvents(toolEvents) {
  const hit = [...(toolEvents ?? [])]
    .reverse()
    .find(
      (e) =>
        e.type === "tool_result" &&
        e.name === "web_search" &&
        e.content &&
        !/^Web search failed/i.test(String(e.content)) &&
        !/^Web search limit/i.test(String(e.content)),
    );
  if (!hit) return [];
  return parseWebSearchSources(hit.content);
}

/**
 * @param {string} reply
 * @param {WebSearchSource[]} sources
 */
export function replyCitesWebSources(reply, sources) {
  const text = String(reply ?? "");
  if (!text.trim() || !sources?.length) return false;

  if (/\bSources?\s*:?\s*\n/i.test(text) || /\bSource\s*:/i.test(text)) {
    return true;
  }

  for (const source of sources) {
    if (text.includes(source.url)) return true;

    try {
      const host = new URL(source.url).hostname.replace(/^www\./, "");
      if (host && text.includes(host)) return true;
    } catch {
      // ignore bad URLs
    }

    if (new RegExp(`\\]\\(${escapeRegex(source.url)}\\)`).test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * @param {Array<{ role?: string, content?: string }>} llmMessages
 */
export function citationNudgeAlreadySent(llmMessages) {
  const tail = (llmMessages ?? []).slice(-8);
  return tail.some(
    (m) => m.role === "user" && /CITE WEB SOURCES/i.test(String(m.content ?? "")),
  );
}

/**
 * @param {WebSearchSource[]} sources
 */
export function buildWebSearchCitationNudge(sources) {
  const list = sources
    .slice(0, 8)
    .map((s, i) => `${i + 1}. ${s.title} — ${s.url}`)
    .join("\n");

  return (
    "CITE WEB SOURCES — your reply used web_search but did not cite source URLs.\n\n" +
    "Re-answer in plain text. For every fact or excerpt from the search results, " +
    "attribute it with the source URL (inline markdown [title](url) or a **Sources** list at the end).\n\n" +
    `Available sources:\n${list}`
  );
}

/**
 * Format web search JSON for the agent with an explicit sources header.
 * @param {unknown} results
 */
export function formatWebSearchResultForAgent(results) {
  if (!Array.isArray(results)) {
    return String(results ?? "");
  }

  const sources = sourcesFromSearchResults(results);
  const header =
    sources.length > 0
      ? sources
          .map((s, i) => `${i + 1}. ${s.title} — ${s.url}`)
          .join("\n")
      : "(no URLs in results)";

  return (
    "WEB SEARCH SOURCES — extract facts from pageContent; cite each fact with its URL. " +
    "Do not tell Jan to visit links instead of answering.\n" +
    `${header}\n\n` +
    `RESULTS JSON:\n${JSON.stringify(results, null, 2)}`
  );
}

/**
 * @param {string} userMessage
 * @param {string} reply
 * @param {Array<{ type?: string, name?: string, content?: string }>} toolEvents
 * @param {{ llmMessages?: Array<{ role?: string, content?: string }> }} conversation
 * @param {string} threadId
 */
export function shouldForceWebSearchCitations(
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

  const sources = getWebSearchSourcesFromEvents(toolEvents);
  if (!sources.length) return false;
  if (replyCitesWebSources(reply, sources)) return false;
  if (citationNudgeAlreadySent(conversation?.llmMessages)) return false;

  return true;
}
