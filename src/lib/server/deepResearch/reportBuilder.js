/**
 * @param {{
 *   sessionId: string,
 *   userQuery: string,
 *   tier: string,
 *   plan: object,
 *   memory: ReturnType<typeof import('./sessionMemory.js').createSessionMemory>,
 *   markdown: string,
 * }} ctx
 */
export function buildResearchReportJson(ctx) {
  const { sessionId, userQuery, tier, plan, memory, markdown } = ctx;

  const citations = memory.sources.map((s, i) => ({
    refId: String(i + 1),
    sourceId: s.id,
    title: s.title,
    url: s.url,
    author: s.author,
    date: s.publishedAt,
    reliabilityScore: s.reliabilityScore,
    usedInSections: [],
  }));

  return {
    sessionId,
    userQuery,
    tier,
    plan,
    markdown,
    sources: memory.sources,
    claims: memory.claims,
    contradictions: memory.contradictions,
    media: memory.media,
    citations,
    stats: {
      searches: memory.searchesPerformed,
      sources: memory.sources.length,
      pagesFetched: memory.pagesFetched,
      images: memory.media.filter((m) => m.type === "image").length,
      videos: memory.media.filter((m) => m.type === "video").length,
    },
  };
}

/**
 * Inject inline media markers after Key Findings for first few media assets.
 * @param {string} markdown
 * @param {Array<object>} media
 */
export function injectMediaMarkers(markdown, media) {
  let result = String(markdown ?? "");
  const gallerySection = "# Media Gallery";
  const idx = result.indexOf(gallerySection);

  const markers = media
    .slice(0, 6)
    .map((m) => `<!-- research:media id=${m.id} type=${m.type} -->`)
    .join("\n");

  if (idx >= 0 && markers) {
    result =
      result.slice(0, idx + gallerySection.length) +
      "\n\n" +
      markers +
      "\n" +
      result.slice(idx + gallerySection.length);
  } else if (markers) {
    result += `\n\n# Media Gallery\n\n${markers}\n`;
  }

  return result;
}
