import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { config } from "../config.js";
import { enrichSearchResultsWithPages } from "../fetchWebPage.js";
import {
  reserveWebSearch,
  completeWebSearch,
} from "../webSearchPolicy.js";
import { searchSearxng, formatSearxngRawResults } from "../searxngSearch.js";
import {
  buildEngineSelectionGuide,
  formatEnginesUsedHeader,
  resolveWebSearchEngines,
} from "../searxngEngines.js";
import { formatWebSearchResultForAgent } from "../webSearchCitations.js";

function formatSearxngResults(raw, hits = []) {
  if (!raw || raw === "No good results found.") {
    return "No search results found. Your one web search this turn returned nothing — proceed using your training knowledge.";
  }

  try {
    const items = JSON.parse(`[${raw}]`);
    const engineByUrl = new Map(
      hits.map((h) => [h.link || h.url, h.engine]).filter(([url]) => url),
    );
    return JSON.stringify(
      items.map((r) => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet,
        ...(engineByUrl.get(r.link) ? { engine: engineByUrl.get(r.link) } : {}),
      })),
      null,
      2,
    );
  } catch {
    return raw;
  }
}

export function createWebSearchTool(ctx = {}) {
  const threadId = ctx.threadId ?? "default";

  return tool(
    async ({ query, engines: requestedEngines, categories }) => {
      const { getTurnResearchQuestion } = await import("../webSearchMemory.js");
      const gate = await reserveWebSearch(threadId, query, {
        userMessage: getTurnResearchQuestion(threadId),
      });
      if (gate.cached) return gate.cached;
      if (!gate.allowed) return gate.message;

      const resolved = resolveWebSearchEngines({
        requested: requestedEngines,
        threadId,
      });
      if (resolved.error) {
        completeWebSearch(threadId, query, resolved.error);
        return resolved.error;
      }

      const searchCategories =
        categories?.trim() || config.searxng.categories;

      try {
        const hits = await searchSearxng(query, {
          apiBase: config.searxng.apiBase,
          params: {
            format: "json",
            numResults: config.searxng.numResults,
            categories: searchCategories,
            ...(resolved.engines ? { engines: resolved.engines } : {}),
            ...(config.searxng.language ? { language: config.searxng.language } : {}),
            safesearch: config.searxng.safesearch,
          },
          headers: config.searxng.headers,
        });
        const results = formatSearxngRawResults(hits);
        let parsed;
        try {
          parsed = JSON.parse(formatSearxngResults(results, hits));
        } catch {
          parsed = null;
        }

        const enriched = parsed
          ? await enrichSearchResultsWithPages(parsed)
          : null;
        const payload = enriched ?? parsed;
        const engineHeader = formatEnginesUsedHeader(resolved.engines, hits);
        const notePrefix = resolved.note ? `${resolved.note}\n` : "";
        const formatted = payload
          ? `${notePrefix}${engineHeader}${formatWebSearchResultForAgent(payload)}`
          : `${notePrefix}${engineHeader}${formatSearxngResults(results, hits)}`;
        completeWebSearch(threadId, query, formatted, {
          engines:
            resolved.engines ||
            [
              ...new Set(
                hits.map((h) => h.engine).filter(Boolean).map((e) => String(e).toLowerCase()),
              ),
            ].join(","),
        });
        return formatted;
      } catch (error) {
        const message =
          `Web search failed: ${error.message}. Your one search attempt this turn is used — proceed using your training knowledge.`;
        completeWebSearch(threadId, query, message, {
          engines: resolved.engines,
        });
        return message;
      }
    },
    {
      name: "web_search",
      description:
        "Search the web via SearXNG for current documentation or facts. " +
        "Top hits include fetched page body text (not just snippets) for deep research. " +
        "When answering from results, cite source URLs for every excerpt. " +
        "Use ONE comprehensive query per task — avoid repeat searches in the same turn. " +
        buildEngineSelectionGuide(),
      schema: z.object({
        query: z.string().describe("Focused search query"),
        engines: z
          .string()
          .optional()
          .describe(
            "Optional comma-separated SearXNG engines (e.g. brave,bing). " +
              "Pick different engines when results are thin or blocked.",
          ),
        categories: z
          .string()
          .optional()
          .describe("Optional SearXNG category (default: general)"),
      }),
    },
  );
}
