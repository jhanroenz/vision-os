import { newId } from "./sessionMemory.js";
import { classifySourceType, scoreReliability } from "./sourceScorer.js";
import { normalizeVideoUrl, extractIframeVideoEmbeds, extractHtml5VideoUrls } from "./videoEmbed.js";

const TRACKING_IMG =
  /pixel|tracker|spacer|1x1|analytics|doubleclick|facebook\.com\/tr/i;

/**
 * @param {import('./sessionMemory.js').createSessionMemory extends (...args: any) => infer R ? R : never} memory
 * @param {{
 *   html: string,
 *   pageUrl: string,
 *   sourceId?: string,
 *   tierBudget: { maxImages: number, maxVideos: number },
 * }} ctx
 */
export function harvestMediaFromHtml(memory, { html, pageUrl, sourceId, tierBudget }) {
  const text = String(html ?? "");
  if (!text) return [];

  const added = [];

  function canAdd(type) {
    const count = memory.media.filter((m) => m.type === type).length;
    if (type === "image") return count < tierBudget.maxImages;
    if (type === "video") return count < tierBudget.maxVideos;
    return true;
  }

  function pushAsset(asset) {
    const key = asset.embedUrl ?? asset.url;
    if (memory.media.some((m) => (m.embedUrl ?? m.url) === key)) return;
    memory.media.push(asset);
    added.push(asset);
  }

  for (const tag of extractMetaTags(text, "og:image")) {
    if (!canAdd("image")) break;
    if (!tag || TRACKING_IMG.test(tag)) continue;
    pushAsset({
      id: newId("media"),
      sessionId: memory.sessionId,
      sourceId,
      type: "image",
      url: tag,
      sourcePageUrl: pageUrl,
      title: extractMetaTags(text, "og:title")[0] ?? "",
      caption: extractMetaTags(text, "og:description")[0] ?? "",
      provider: "og",
      placement: "gallery",
    });
  }

  for (const tag of [
    ...extractMetaTags(text, "og:video"),
    ...extractMetaTags(text, "og:video:url"),
    ...extractMetaTags(text, "og:video:secure_url"),
    ...extractMetaTags(text, "twitter:player"),
  ]) {
    if (!canAdd("video")) break;
    const video = normalizeVideoUrl(tag) ?? {
      provider: "html5",
      watchUrl: tag,
      embedUrl: tag,
    };
    pushAsset({
      id: newId("media"),
      sessionId: memory.sessionId,
      sourceId,
      type: "video",
      url: video.watchUrl ?? tag,
      embedUrl: video.embedUrl ?? tag,
      thumbnailUrl: video.thumbnailUrl ?? extractMetaTags(text, "og:image")[0],
      sourcePageUrl: pageUrl,
      title: extractMetaTags(text, "og:title")[0] ?? "",
      provider: video.provider ?? "og",
      placement: "gallery",
    });
  }

  for (const match of text.matchAll(/<img[^>]+>/gi)) {
    if (!canAdd("image")) break;
    const tag = match[0];
    const src = attr(tag, "src");
    if (!src || src.startsWith("data:") || TRACKING_IMG.test(src)) continue;
    const w = Number(attr(tag, "width"));
    const h = Number(attr(tag, "height"));
    if ((w && w < 32) || (h && h < 32)) continue;
    let absolute = src;
    try {
      absolute = new URL(src, pageUrl).href;
    } catch {
      continue;
    }
    pushAsset({
      id: newId("media"),
      sessionId: memory.sessionId,
      sourceId,
      type: "image",
      url: absolute,
      sourcePageUrl: pageUrl,
      title: attr(tag, "alt") ?? "",
      caption: attr(tag, "alt") ?? "",
      provider: "inline",
      placement: "gallery",
    });
  }

  for (const video of extractIframeVideoEmbeds(text, pageUrl)) {
    if (!canAdd("video")) break;
    pushAsset({
      id: newId("media"),
      sessionId: memory.sessionId,
      sourceId,
      type: "video",
      url: video.watchUrl ?? video.embedUrl,
      embedUrl: video.embedUrl,
      thumbnailUrl: video.thumbnailUrl ?? extractMetaTags(text, "og:image")[0],
      sourcePageUrl: pageUrl,
      title: extractMetaTags(text, "og:title")[0] ?? "",
      provider: video.provider ?? "iframe",
      placement: "gallery",
    });
  }

  for (const video of extractHtml5VideoUrls(text, pageUrl)) {
    if (!canAdd("video")) break;
    pushAsset({
      id: newId("media"),
      sessionId: memory.sessionId,
      sourceId,
      type: "video",
      url: video.watchUrl,
      embedUrl: video.embedUrl,
      thumbnailUrl: extractMetaTags(text, "og:image")[0],
      sourcePageUrl: pageUrl,
      title: extractMetaTags(text, "og:title")[0] ?? "",
      provider: "html5",
      placement: "gallery",
    });
  }

  for (const raw of extractVideoUrlsFromPage(text)) {
    if (!canAdd("video")) break;
    const video = normalizeVideoUrl(raw, { pageUrl });
    if (!video?.embedUrl) continue;
    pushAsset({
      id: newId("media"),
      sessionId: memory.sessionId,
      sourceId,
      type: "video",
      url: video.watchUrl ?? raw,
      embedUrl: video.embedUrl,
      thumbnailUrl: video.thumbnailUrl,
      sourcePageUrl: pageUrl,
      title: "",
      provider: video.provider ?? "iframe",
      placement: "gallery",
    });
  }

  return added;
}

function extractVideoUrlsFromPage(html) {
  const found = new Set();
  const urlPattern = /https?:\/\/[^\s"'<>]+/gi;
  for (const raw of String(html ?? "").match(urlPattern) ?? []) {
    const cleaned = raw.replace(/[)"'\\]+$/, "");
    if (normalizeVideoUrl(cleaned)) found.add(cleaned);
  }
  return [...found];
}

function extractMetaTags(html, property) {
  const results = [];
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']|` +
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "gi",
  );
  for (const m of html.matchAll(re)) {
    const val = m[1] ?? m[2];
    if (val) results.push(val.trim());
  }
  return results;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}=["']([^"']*)["']`, "i"));
  return m?.[1]?.trim() ?? "";
}

/**
 * @param {ReturnType<typeof import('./sessionMemory.js').createSessionMemory>} memory
 * @param {{ title: string, url: string, category?: string }} hit
 */
export function harvestMediaFromSearchHit(memory, hit, tierBudget) {
  const url = String(hit.url ?? hit.link ?? "").trim();
  if (!url) return [];

  if (hit.category === "images" || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)) {
    if (memory.media.filter((m) => m.type === "image").length >= tierBudget.maxImages) {
      return [];
    }
    const asset = {
      id: newId("media"),
      sessionId: memory.sessionId,
      type: "image",
      url,
      sourcePageUrl: url,
      title: hit.title ?? "",
      caption: hit.title ?? "",
      provider: "searxng",
      placement: "gallery",
    };
    if (!memory.media.some((m) => m.url === url)) {
      memory.media.push(asset);
      return [asset];
    }
  }

  const video = normalizeVideoUrl(url);
  if (video?.embedUrl) {
    if (memory.media.filter((m) => m.type === "video").length >= tierBudget.maxVideos) {
      return [];
    }
    const asset = {
      id: newId("media"),
      sessionId: memory.sessionId,
      type: "video",
      url: video.watchUrl ?? url,
      embedUrl: video.embedUrl,
      thumbnailUrl: video.thumbnailUrl,
      sourcePageUrl: url,
      title: hit.title ?? "",
      provider: video.provider ?? "iframe",
      placement: "gallery",
    };
    if (!memory.media.some((m) => m.embedUrl === asset.embedUrl)) {
      memory.media.push(asset);
      return [asset];
    }
  }

  return [];
}
