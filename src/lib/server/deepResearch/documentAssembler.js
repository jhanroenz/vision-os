import { assignMediaToSections } from "./sectionMediaPlanner.js";

/**
 * Parse markdown into H1 sections.
 * @param {string} markdown
 * @returns {Array<{ id: string, title: string, level: number, bodyMarkdown: string }>}
 */
export function parseMarkdownSections(markdown) {
  const text = String(markdown ?? "").trim();
  if (!text) return [];

  const lines = text.split("\n");
  /** @type {Array<{ id: string, title: string, level: number, bodyMarkdown: string }>} */
  const sections = [];
  let current = null;

  function slugify(/** @type {string} */ title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 48) || "section";
  }

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) {
      if (current) sections.push(current);
      const title = h1[1].trim();
      current = {
        id: slugify(title),
        title,
        level: 1,
        bodyMarkdown: "",
      };
      continue;
    }
    if (current) {
      current.bodyMarkdown += (current.bodyMarkdown ? "\n" : "") + line;
    }
  }
  if (current) sections.push(current);

  const seen = new Map();
  return sections.map((s) => {
    const base = s.id;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...s, id: n > 1 ? `${base}_${n}` : base, bodyMarkdown: s.bodyMarkdown.trim() };
  });
}

/**
 * Extract deck line from first section if present (> line starting with > or italic subtitle).
 * @param {string} markdown
 */
function extractDeck(markdown) {
  const firstBlock = String(markdown ?? "").split(/^#\s/m)[1];
  if (!firstBlock) return "";
  const lines = firstBlock.split("\n").slice(1);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const quote = trimmed.match(/^>\s*(.+)$/);
    if (quote) return quote[1].trim();
    const italic = trimmed.match(/^\*(.+)\*$/) || trimmed.match(/^_(.+)_$/);
    if (italic) return italic[1].trim();
    break;
  }
  return "";
}

/**
 * Rebuild markdown from structured document sections.
 * @param {Array<{ title: string, bodyMarkdown: string }>} sections
 */
export function sectionsToMarkdown(sections) {
  return sections
    .map((s) => `# ${s.title}\n\n${s.bodyMarkdown}`.trim())
    .join("\n\n");
}

/**
 * @param {{
 *   userQuery: string,
 *   subjectLabel?: string,
 *   documentType: string,
 *   templateLabel: string,
 *   markdown: string,
 *   media: Array<object>,
 *   sources: Array<object>,
 *   tier?: string,
 * }} ctx
 */
export function assembleResearchDocument(ctx) {
  const {
    userQuery,
    subjectLabel,
    documentType,
    templateLabel,
    markdown,
    media,
    sources,
    tier,
  } = ctx;

  const rawSections = parseMarkdownSections(markdown);
  const { sections: placedSections, media: placedMedia } = assignMediaToSections(rawSections, media, sources);

  const title = (subjectLabel || userQuery).replace(/\?+$/, "").trim();
  const deck = extractDeck(markdown) || `Deep research report · ${templateLabel}`;

  const document = {
    documentType,
    templateLabel,
    title,
    deck,
    generatedAt: Date.now(),
    tier: tier ?? "standard",
    sections: placedSections,
    stats: {
      sources: sources.length,
      images: placedMedia.filter((/** @type {{ type?: string }} */ m) => m.type === "image").length,
      videos: placedMedia.filter((/** @type {{ type?: string }} */ m) => m.type === "video").length,
      inlineFigures: placedSections.reduce((n, /** @type {{ figures?: unknown[] }} */ s) => n + (s.figures?.length ?? 0), 0),
    },
  };

  const assembledMarkdown = sectionsToMarkdown(
    /** @type {Array<{ title: string, bodyMarkdown: string }>} */ (placedSections),
  );

  return {
    document,
    markdown: assembledMarkdown,
    media: placedMedia,
  };
}
