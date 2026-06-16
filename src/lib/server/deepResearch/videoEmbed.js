/**
 * Normalize video URLs to embed form + thumbnail hints.
 * Supports YouTube/Vimeo plus generic iframe embeds and direct HTML5 files.
 * @returns {{ embedUrl?: string, thumbnailUrl?: string, provider?: string, watchUrl: string } | null}
 */
export function normalizeVideoUrl(rawUrl, { pageUrl } = {}) {
  const url = String(rawUrl ?? "").trim();
  if (!url) return null;

  let parsed;
  try {
    parsed = new URL(url, pageUrl);
  } catch {
    return null;
  }

  const canonical = parsed.href;
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0];
    if (!id) return null;
    return youtubeMeta(id, `https://youtu.be/${id}`);
  }

  if (host === "youtube.com" || host === "m.youtube.com") {
    if (parsed.pathname.startsWith("/embed/")) {
      const id = parsed.pathname.split("/")[2];
      if (id) return youtubeMeta(id, `https://www.youtube.com/watch?v=${id}`);
    }
    const v = parsed.searchParams.get("v");
    if (v) return youtubeMeta(v, `https://www.youtube.com/watch?v=${v}`);
  }

  if (host === "vimeo.com") {
    const id = parsed.pathname.split("/").filter(Boolean)[0];
    if (id && /^\d+$/.test(id)) {
      return iframeMeta(`https://player.vimeo.com/video/${id}`, `https://vimeo.com/${id}`, "vimeo");
    }
  }

  if (host === "player.vimeo.com") {
    const id = parsed.pathname.split("/").filter(Boolean).pop();
    if (id && /^\d+$/.test(id)) {
      return iframeMeta(`https://player.vimeo.com/video/${id}`, `https://vimeo.com/${id}`, "vimeo");
    }
  }

  if (isDirectVideoFile(parsed)) {
    return html5Meta(canonical);
  }

  const derived = deriveEmbedFromWatchPage(parsed, canonical);
  if (derived) return derived;

  if (looksLikeEmbedUrl(parsed)) {
    return iframeMeta(canonical);
  }

  return null;
}

function youtubeMeta(id, watchUrl) {
  return {
    provider: "youtube",
    watchUrl,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

function iframeMeta(embedUrl, watchUrl = embedUrl, provider = "iframe") {
  return { provider, watchUrl, embedUrl };
}

function html5Meta(url) {
  return { provider: "html5", watchUrl: url, embedUrl: url };
}

function isDirectVideoFile(parsed) {
  return /\.(mp4|webm|ogg|ogv|m3u8)(\?|$)/i.test(parsed.pathname);
}

/** Paths/hosts that usually mean an embeddable player document. */
function looksLikeEmbedUrl(parsed) {
  const path = parsed.pathname.toLowerCase();
  if (/\/embed(?:\/|$|\.)/i.test(path)) return true;
  if (/\/embedframe(?:\/|$)/i.test(path)) return true;
  if (/\/player(?:\/|$)/i.test(path)) return true;
  if (/^player\./i.test(parsed.hostname)) return true;
  if (parsed.searchParams.get("embed") === "1") return true;
  return false;
}

/**
 * Common watch-page → embed-page patterns (works for many tube-style sites).
 */
function deriveEmbedFromWatchPage(parsed, watchUrl) {
  const segments = parsed.pathname.split("/").filter(Boolean);

  // /video/{id}/... → /embed/{id}
  const videoIdx = segments.findIndex((s) => s === "video");
  if (videoIdx >= 0 && segments[videoIdx + 1] && /^\d+$/.test(segments[videoIdx + 1])) {
    const id = segments[videoIdx + 1];
    const embed = new URL(watchUrl);
    embed.pathname = `/embed/${id}`;
    embed.search = "";
    embed.hash = "";
    return iframeMeta(embed.href, watchUrl);
  }

  // ?viewkey=... style pages
  const viewkey =
    parsed.searchParams.get("viewkey") ??
    parsed.searchParams.get("v") ??
    parsed.searchParams.get("id");
  if (viewkey && /\/view_/i.test(parsed.pathname)) {
    const embed = new URL(watchUrl);
    embed.pathname = "/embed/" + viewkey;
    embed.search = "";
    return iframeMeta(embed.href, watchUrl);
  }

  // /videos/{slug-or-id} → /embed/{last-segment}
  if (segments[0] === "videos" && segments[1]) {
    const id = segments[segments.length - 1];
    const embed = new URL(watchUrl);
    embed.pathname = `/embed/${id}`;
    embed.search = "";
    return iframeMeta(embed.href, watchUrl);
  }

  return null;
}

export function extractVideoUrlsFromHtml(html) {
  const found = new Set();
  const text = String(html ?? "");

  const patterns = [
    /https?:\/\/[^\s"'<>]+/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.match(pattern) ?? []) {
      const cleaned = match.replace(/[)"'\\]+$/, "");
      const normalized = normalizeVideoUrl(cleaned);
      if (normalized?.embedUrl) found.add(cleaned);
    }
  }

  return [...found];
}

const IFRAME_BLOCK =
  /doubleclick|googlesyndication|googletag|facebook\.com|twitter\.com|adservice|about:blank|recaptcha|google\.com\/maps/i;

/**
 * @param {string} html
 * @param {string} pageUrl
 */
export function extractIframeVideoEmbeds(html, pageUrl) {
  const results = [];
  const seen = new Set();

  for (const match of String(html ?? "").matchAll(/<iframe[^>]+>/gi)) {
    const src = attr(match[0], "src");
    if (!src || IFRAME_BLOCK.test(src)) continue;

    let absolute;
    try {
      absolute = new URL(src, pageUrl).href;
    } catch {
      continue;
    }

    if (seen.has(absolute)) continue;
    seen.add(absolute);

    const normalized =
      normalizeVideoUrl(absolute) ?? (looksLikeEmbedUrl(new URL(absolute)) ? iframeMeta(absolute) : null);
    if (normalized?.embedUrl) results.push(normalized);
  }

  return results;
}

/**
 * @param {string} html
 * @param {string} pageUrl
 */
export function extractHtml5VideoUrls(html, pageUrl) {
  const results = [];
  const seen = new Set();

  for (const match of String(html ?? "").matchAll(/<(?:video|source)[^>]+>/gi)) {
    const src = attr(match[0], "src");
    if (!src) continue;

    let absolute;
    try {
      absolute = new URL(src, pageUrl).href;
    } catch {
      continue;
    }

    const parsed = new URL(absolute);
    if (!isDirectVideoFile(parsed)) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);

    results.push(html5Meta(absolute));
  }

  return results;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}=["']([^"']*)["']`, "i"));
  return m?.[1]?.trim() ?? "";
}
