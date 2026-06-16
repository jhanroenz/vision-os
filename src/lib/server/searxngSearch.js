/**
 * Lightweight SearXNG client (replaces @langchain/community SearxngSearch).
 */

function buildSearchUrl(apiBase, parameters) {
  const base = String(apiBase ?? "").replace(/\/+$/, "");
  const searchParams = new URLSearchParams(
    Object.entries(parameters)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  return `${base}/search?${searchParams}`;
}

/**
 * @returns {Promise<Array<{ title: string, link: string, snippet: string }>>}
 */
export async function searchSearxng(
  query,
  { apiBase, params = {}, headers = {}, timeoutMs = 5000 } = {},
) {
  if (!apiBase) {
    throw new Error(
      "SEARXNG apiBase is required. Set SEARXNG_API_BASE in the environment.",
    );
  }

  const mergedParams = {
    format: "json",
    numResults: 10,
    pageNumber: 1,
    imageProxy: true,
    safesearch: 0,
    ...params,
    q: query,
  };

  const url = buildSearchUrl(apiBase, mergedParams);
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    throw new Error(resp.statusText || `SearXNG HTTP ${resp.status}`);
  }

  const res = await resp.json();
  const limit = Number(mergedParams.numResults) || 10;

  if (res.results?.length) {
    return res.results.slice(0, limit).map((r) => ({
      title: r.title ?? "",
      link: r.url ?? "",
      url: r.url ?? "",
      snippet: r.content ?? "",
      publishedDate: r.publishedDate ?? r.pubdate ?? undefined,
      author: r.author ?? r.publisher ?? undefined,
      engine: r.engine ?? undefined,
      category: r.category ?? params.categories ?? undefined,
    }));
  }

  if (res.answers?.length) {
    return [{ title: "Answer", link: "", snippet: String(res.answers[0]) }];
  }

  if (res.infoboxes?.length) {
    const content = String(res.infoboxes[0]?.content ?? "").replace(
      /<[^>]+>/gi,
      "",
    );
    return [{ title: "Infobox", link: "", snippet: content }];
  }

  if (res.suggestions?.length) {
    return [
      {
        title: "Suggestions",
        link: "",
        snippet: `Suggestions: ${res.suggestions.join(", ")}`,
      },
    ];
  }

  return [];
}

/**
 * Rich SearXNG search for deep research (same shape, explicit name).
 * @returns {Promise<Array<{ title: string, link: string, url: string, snippet: string, publishedDate?: string, author?: string, engine?: string, category?: string }>>}
 */
export async function searchSearxngRich(query, options = {}) {
  return searchSearxng(query, options);
}

/** Legacy comma-joined JSON string format from langchain SearxngSearch. */
export function formatSearxngRawResults(results) {
  if (!results.length) return "No good results found.";
  return results
    .map((r) =>
      JSON.stringify({
        title: r.title,
        link: r.link,
        snippet: r.snippet,
      }),
    )
    .join(",");
}
