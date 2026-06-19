/**
 * @param {{
 *   sessionId: string,
 *   userQuery: string,
 *   tier: string,
 *   plan: object,
 *   memory: ReturnType<typeof import('./sessionMemory.js').createSessionMemory>,
 *   markdown: string,
 *   document?: object,
 *   classification?: { documentType: string, subjectLabel: string, confidence: number },
 * }} ctx
 */
export function buildResearchReportJson(ctx) {
  const { sessionId, userQuery, tier, plan, memory, markdown, document, classification } = ctx;

  const citations = memory.sources.map((s, i) => ({
    refId: String(i + 1),
    sourceId: s.id,
    title: s.title,
    url: s.url,
    author: s.author,
    date: s.publishedAt,
    reliabilityScore: s.reliabilityScore,
    usedInSections: document?.sections
      ?.filter((sec) => String(sec.bodyMarkdown ?? "").includes(s.title))
      .map((sec) => sec.id) ?? [],
  }));

  return {
    sessionId,
    userQuery,
    tier,
    plan,
    markdown,
    document: document ?? null,
    classification: classification ?? null,
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
      inlineFigures: document?.stats?.inlineFigures ?? 0,
      documentType: document?.documentType ?? classification?.documentType ?? "investigative",
    },
  };
}
