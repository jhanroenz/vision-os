import { config } from "./config.js";

function extractMainHtml(html) {
  const text = String(html ?? "");
  return (
    text.match(/<main[\s>][\s\S]*?<\/main>/i)?.[0] ||
    text.match(/<article[\s>][\s\S]*?<\/article>/i)?.[0] ||
    text.match(/<body[\s>][\s\S]*?<\/body>/i)?.[0] ||
    text
  );
}

function preservePreBlocks(html) {
  const blocks = new Map();
  let idx = 0;
  const marked = html.replace(/<(pre|code)[^>]*>[\s\S]*?<\/\1>/gi, (block) => {
    const key = `\n__PRE_BLOCK_${idx++}__\n`;
    blocks.set(
      key,
      block
        .replace(/<[^>]+>/g, "")
        .replace(/[ \t]+/g, " ")
        .trim(),
    );
    return key;
  });
  return { html: marked, blocks };
}

export function htmlToText(html) {
  let raw = extractMainHtml(html);
  raw = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const { html: marked, blocks } = preservePreBlocks(raw);

  let text = marked
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  for (const [key, val] of blocks) {
    text = text.replace(key, `\n${val}\n`);
  }

  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function truncate(text, max, label = "content") {
  if (!text || text.length <= max) return text;
  const omitted = text.length - max;
  return `${text.slice(0, max)}\n\n[${label} truncated: ${omitted} chars omitted]`;
}

export async function fetchPageText(url, options = {}) {
  const maxChars = options.maxChars ?? config.searxng.fetchMaxChars;
  const timeoutMs = options.timeoutMs ?? config.searxng.fetchTimeoutMs;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Jarvis-Agent/1.0 (research)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error(`Unsupported content-type: ${contentType || "unknown"}`);
    }

    const html = await response.text();
    return truncate(htmlToText(html), maxChars, "page");
  } catch (error) {
    const message =
      error.name === "AbortError"
        ? `Timed out after ${timeoutMs}ms`
        : error.message;
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch raw HTML for media/metadata extraction (deep research). */
export async function fetchPageHtml(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? config.searxng.fetchTimeoutMs;
  const maxChars = options.maxChars ?? 500_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Jarvis-Agent/1.0 (research)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error(`Unsupported content-type: ${contentType || "unknown"}`);
    }

    const html = await response.text();
    return html.length > maxChars ? html.slice(0, maxChars) : html;
  } catch (error) {
    const message =
      error.name === "AbortError"
        ? `Timed out after ${timeoutMs}ms`
        : error.message;
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export async function enrichSearchResultsWithPages(results) {
  const fetchCount = Math.min(
    config.searxng.fetchPages,
    config.searxng.numResults,
    Array.isArray(results) ? results.length : 0,
  );
  if (!fetchCount || fetchCount <= 0 || !Array.isArray(results) || !results.length) {
    return results;
  }

  const toFetch = results.slice(0, fetchCount);
  const rest = results.slice(fetchCount);

  const enriched = await mapWithConcurrency(
    toFetch,
    config.searxng.fetchConcurrency ?? 3,
    async (result) => {
      if (!result?.url) return result;
      try {
        const pageContent = await fetchPageText(result.url);
        return { ...result, pageContent };
      } catch (error) {
        return {
          ...result,
          pageContent: `[Page fetch failed: ${error.message}]`,
        };
      }
    },
  );

  return [...enriched, ...rest];
}
