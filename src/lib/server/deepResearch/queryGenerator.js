/**
 * @param {string} userQuery
 * @returns {{ objective: string, subQuestions: string[], queries: Array<{ q: string, category: string, rationale: string, priority: number }> }}
 */
export function buildResearchPlan(userQuery) {
  const objective = String(userQuery ?? "").trim();
  const topic = objective.replace(/\?+$/, "").trim();

  const subQuestions = [
    `What are the key facts about ${topic}?`,
    `What do official or primary sources say about ${topic}?`,
    `What recent updates or news exist for ${topic}?`,
    `Are there tutorials, talks, or videos explaining ${topic}?`,
  ];

  const queries = [
    {
      q: topic,
      category: "general",
      rationale: "Broad overview",
      priority: 1,
    },
    {
      q: `${topic} official documentation`,
      category: "general",
      rationale: "Primary sources",
      priority: 2,
    },
    {
      q: `${topic} latest news`,
      category: "news",
      rationale: "Recent developments",
      priority: 3,
    },
    {
      q: `${topic} video`,
      category: "videos",
      rationale: "Video explainers (any site)",
      priority: 4,
    },
    {
      q: topic,
      category: "images",
      rationale: "Diagrams and visuals",
      priority: 5,
    },
  ];

  return { objective, subQuestions, queries };
}

/**
 * @param {string} objective
 * @param {ReturnType<typeof import('./sessionMemory.js').createSessionMemory>} memory
 */
export function suggestFollowUpQueries(objective, memory) {
  const gaps = [];
  const followUp = [];

  const types = new Set(memory.sources.map((s) => s.sourceType));
  if (!types.has("official") && !types.has("docs")) {
    gaps.push("Missing official documentation sources");
    followUp.push({
      q: `${objective} official site documentation`,
      category: "general",
      rationale: "Fill official source gap",
      priority: 1,
    });
  }
  if (!types.has("news")) {
    gaps.push("Missing recent news coverage");
    followUp.push({
      q: `${objective} news 2024 2025 2026`,
      category: "news",
      rationale: "Recent news gap",
      priority: 2,
    });
  }
  if (memory.media.filter((m) => m.type === "video").length === 0) {
    gaps.push("No videos collected yet");
    followUp.push({
      q: `${objective} video`,
      category: "videos",
      rationale: "Video gap",
      priority: 3,
    });
  }

  return { gaps, followUp };
}
