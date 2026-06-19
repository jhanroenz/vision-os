const FIGURE_MARKER =
  /<!--\s*research:figure\s+section=(?<section>[^\s>]+)\s+media=(?<media>[^\s>]+)(?:\s+caption="(?<caption>[^"]*)")?\s*-->/gi;

const LEGACY_MEDIA_MARKER =
  /<!--\s*research:media\s+id=(?<media>[^\s>]+)(?:\s+type=(?<type>[^\s>]+))?\s*-->/gi;

/**
 * @param {string} body
 * @returns {Array<{ sectionId: string, mediaId: string, caption: string }>}
 */
export function parseFigureMarkers(body) {
  const figures = [];
  const text = String(body ?? "");

  for (const match of text.matchAll(FIGURE_MARKER)) {
    figures.push({
      sectionId: match.groups?.section ?? "",
      mediaId: match.groups?.media ?? "",
      caption: match.groups?.caption ?? "",
    });
  }

  for (const match of text.matchAll(LEGACY_MEDIA_MARKER)) {
    figures.push({
      sectionId: "",
      mediaId: match.groups?.media ?? "",
      caption: "",
    });
  }

  return figures;
}

/**
 * Strip figure/media HTML comments from markdown body.
 * @param {string} body
 */
export function stripFigureMarkers(body) {
  return String(body ?? "")
    .replace(FIGURE_MARKER, "")
    .replace(LEGACY_MEDIA_MARKER, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Score how well media fits a section.
 * @param {object} media
 * @param {object} section
 * @param {Array<object>} sources
 */
function scoreMediaForSection(media, section, sources) {
  let score = 0;
  const haystack = `${section.title} ${section.id} ${section.bodyMarkdown ?? ""}`.toLowerCase();
  const needle = `${media.title ?? ""} ${media.caption ?? ""}`.toLowerCase();

  for (const word of needle.split(/\s+/).filter((w) => w.length > 4)) {
    if (haystack.includes(word)) score += 2;
  }

  if (media.sourceId) {
    const src = sources.find((s) => s.id === media.sourceId);
    if (src?.title && haystack.includes(src.title.toLowerCase().slice(0, 20))) {
      score += 3;
    }
  }

  if (media.type === "image") score += 1;
  return score;
}

/**
 * Auto-assign images to sections when the model omitted figure markers.
 * @param {Array<{ id: string, title: string, bodyMarkdown?: string }>} sections
 * @param {Array<object>} media
 * @param {Array<object>} sources
 * @param {Map<string, Set<string>>} existingBySection
 */
function autoAssignFigures(sections, media, sources, existingBySection) {
  const contentSections = sections.filter((s) => !/sources|references/i.test(s.title));
  const images = media.filter((m) => m.type === "image");
  const assignedMediaIds = new Set();

  for (const section of contentSections) {
    const existing = existingBySection.get(section.id) ?? new Set();
    if (existing.size >= 2) continue;

    const ranked = images
      .filter((m) => !assignedMediaIds.has(m.id) && !existing.has(m.id))
      .map((m) => ({ media: m, score: scoreMediaForSection(m, section, sources) }))
      .sort((a, b) => b.score - a.score);

    const pick = ranked.find((r) => r.score > 0) ?? ranked[0];
    if (!pick || existing.size >= 2) continue;
    if (existing.size === 0 || pick.score > 0) {
      if (!existingBySection.has(section.id)) existingBySection.set(section.id, new Set());
      existingBySection.get(section.id).add(pick.media.id);
      assignedMediaIds.add(pick.media.id);
    }
  }
}

/**
 * Build per-section figure lists and update media placement.
 * @param {Array<{ id: string, title: string, bodyMarkdown: string }>} sections
 * @param {Array<object>} media
 * @param {Array<object>} sources
 * @returns {{ sections: Array<object>, media: Array<object> }}
 */
export function assignMediaToSections(sections, media, sources) {
  const mediaById = new Map(media.map((m) => [m.id, { ...m }]));
  const existingBySection = new Map();

  const enrichedSections = sections.map((section) => {
    const parsed = parseFigureMarkers(section.bodyMarkdown);
    const figureIds = new Set();

    for (const fig of parsed) {
      if (!fig.mediaId || !mediaById.has(fig.mediaId)) continue;
      const sid = fig.sectionId || section.id;
      if (sid !== section.id && fig.sectionId) continue;
      figureIds.add(fig.mediaId);
      if (!existingBySection.has(section.id)) existingBySection.set(section.id, new Set());
      existingBySection.get(section.id).add(fig.mediaId);
    }

    const figures = [...figureIds].map((mediaId) => {
      const asset = mediaById.get(mediaId);
      const parsedFig = parsed.find((p) => p.mediaId === mediaId);
      return {
        mediaId,
        caption: parsedFig?.caption || asset?.caption || asset?.title || "",
        type: asset?.type ?? "image",
      };
    });

    return {
      ...section,
      bodyMarkdown: stripFigureMarkers(section.bodyMarkdown),
      figures,
    };
  });

  autoAssignFigures(enrichedSections, media, sources, existingBySection);

  for (const section of enrichedSections) {
    const extra = existingBySection.get(section.id);
    if (!extra) continue;
    for (const mediaId of extra) {
      if (section.figures.some((f) => f.mediaId === mediaId)) continue;
      if (section.figures.length >= 2) break;
      const asset = mediaById.get(mediaId);
      section.figures.push({
        mediaId,
        caption: asset?.caption || asset?.title || "",
        type: asset?.type ?? "image",
      });
    }
  }

  const inlineIds = new Set();
  for (const section of enrichedSections) {
    for (const fig of section.figures) inlineIds.add(fig.mediaId);
  }

  const updatedMedia = media.map((m) => ({
    ...m,
    placement: inlineIds.has(m.id) ? "inline" : "gallery",
  }));

  return { sections: enrichedSections, media: updatedMedia };
}
