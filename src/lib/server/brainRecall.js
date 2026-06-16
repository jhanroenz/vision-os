import { config } from "./config.js";
import { getDb } from "./db.js";
import { memoryPromptBody, skillPromptBody } from "./compress.js";
import { searchBrainSemantic } from "./brainIndex.js";
import { memoryMatchesProjectScope, normalizeBrainProject, projectScopeLabel } from "./brainProject.js";

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

function textMatchScore(queryTokens, ...fields) {
  if (!queryTokens.length) return 0;
  const hay = tokenize(fields.filter(Boolean).join(" "));
  if (!hay.length) return 0;

  const haySet = new Set(hay);
  let hits = 0;
  for (const token of queryTokens) {
    if (haySet.has(token)) {
      hits += 1;
      continue;
    }
    if (hay.some((h) => h.includes(token) || token.includes(h))) {
      hits += 0.6;
    }
  }
  return hits / queryTokens.length;
}

function recencyBoost(isoDate, maxBoost = 0.12) {
  if (!isoDate) return 0;
  const ageMs = Date.now() - new Date(isoDate).getTime();
  const days = ageMs / (1000 * 60 * 60 * 24);
  if (days <= 1) return maxBoost;
  if (days <= 7) return maxBoost * 0.7;
  if (days <= 30) return maxBoost * 0.35;
  return 0;
}

function keywordMemoryScore(row, queryTokens) {
  const textScore = textMatchScore(
    queryTokens,
    row.title,
    row.content,
    row.prompt_text,
    row.category,
  );
  const importanceBoost = ((row.importance ?? 3) / 5) * 0.35;
  return {
    textScore,
    total: textScore + importanceBoost + recencyBoost(row.updated_at),
  };
}

function keywordSkillScore(row, queryTokens) {
  const textScore = textMatchScore(
    queryTokens,
    row.name,
    row.description,
    row.instructions,
    row.prompt_text,
  );
  return {
    textScore,
    total: textScore + recencyBoost(row.updated_at, 0.1),
  };
}

function formatMemoryHit(row, score, match = "hybrid") {
  return {
    type: "memory",
    id: row.id,
    title: row.title,
    category: row.category,
    project: row.project ?? null,
    importance: row.importance,
    content: memoryPromptBody(row),
    score: Number(score.toFixed(3)),
    match,
  };
}

function formatSkillHit(row, score, match = "hybrid") {
  return {
    type: "skill",
    id: row.id,
    name: row.name,
    description: row.description,
    project: row.project ?? null,
    instructions: skillPromptBody(row),
    score: Number(score.toFixed(3)),
    match,
  };
}

function loadScopedRows(type, project) {
  if (type === "memory") {
    return getDb()
      .prepare(`SELECT * FROM core_memories WHERE enabled = 1`)
      .all()
      .filter((row) => memoryMatchesProjectScope(row.project, project));
  }
  if (type === "skill") {
    return getDb()
      .prepare(`SELECT * FROM skills WHERE enabled = 1`)
      .all()
      .filter((row) => memoryMatchesProjectScope(row.project, project));
  }
  return [];
}

export function mergeHybridScores({
  queryTokens,
  semanticHits,
  memoryRows,
  skillRows,
  type,
}) {
  const semanticByKey = new Map();
  for (const hit of semanticHits) {
    semanticByKey.set(`${hit.brainType}:${hit.itemId}`, hit.score);
  }

  const maxSemantic = Math.max(0, ...semanticHits.map((h) => h.score));
  const memories = [];
  const skills = [];

  if (type === "memory" || type === "both") {
    for (const row of memoryRows) {
      const key = `memory:${row.id}`;
      const semanticRaw = semanticByKey.get(key) ?? 0;
      const semanticNorm = maxSemantic > 0 ? semanticRaw / maxSemantic : 0;
      const keywordScore = keywordMemoryScore(row, queryTokens);
      const keywordNorm = Math.min(keywordScore.total / 1.5, 1);

      const hasSemantic =
        semanticRaw >= config.evolution.brainSemantic.minScore;
      const hasKeyword = keywordScore.textScore > 0;

      if (!hasSemantic && !hasKeyword) continue;

      const hybrid =
        hasSemantic && hasKeyword
          ? semanticNorm * 0.55 +
            keywordNorm * 0.35 +
            ((row.importance ?? 3) / 5) * 0.1
          : hasSemantic
            ? semanticNorm * 0.85 + ((row.importance ?? 3) / 5) * 0.15
            : keywordNorm;

      memories.push(
        formatMemoryHit(
          row,
          hybrid,
          hasSemantic ? (hasKeyword ? "hybrid" : "semantic") : "keyword",
        ),
      );
    }
    memories.sort((a, b) => b.score - a.score);
  }

  if (type === "skill" || type === "both") {
    for (const row of skillRows) {
      const key = `skill:${row.id}`;
      const semanticRaw = semanticByKey.get(key) ?? 0;
      const semanticNorm = maxSemantic > 0 ? semanticRaw / maxSemantic : 0;
      const keywordScore = keywordSkillScore(row, queryTokens);
      const keywordNorm = Math.min(keywordScore.total / 1.2, 1);

      const hasSemantic =
        semanticRaw >= config.evolution.brainSemantic.minScore;
      const hasKeyword = keywordScore.textScore > 0;

      if (!hasSemantic && !hasKeyword) continue;

      const hybrid = hasSemantic
        ? hasKeyword
          ? semanticNorm * 0.6 + keywordNorm * 0.4
          : semanticNorm
        : keywordNorm;

      skills.push(
        formatSkillHit(
          row,
          hybrid,
          hasSemantic ? (hasKeyword ? "hybrid" : "semantic") : "keyword",
        ),
      );
    }
    skills.sort((a, b) => b.score - a.score);
  }

  return { memories, skills };
}

function keywordOnlyRecall({ type, max, queryTokens, project }) {
  const memories = [];
  const skills = [];

  if (type === "memory" || type === "both") {
    for (const row of loadScopedRows("memory", project)) {
      const score = keywordMemoryScore(row, queryTokens);
      if (score.textScore <= 0) continue;
      memories.push(formatMemoryHit(row, score.total, "keyword"));
    }
    memories.sort((a, b) => b.score - a.score);
  }

  if (type === "skill" || type === "both") {
    for (const row of loadScopedRows("skill", project)) {
      const score = keywordSkillScore(row, queryTokens);
      if (score.textScore <= 0) continue;
      skills.push(formatSkillHit(row, score.total, "keyword"));
    }
    skills.sort((a, b) => b.score - a.score);
  }

  const cap = type === "both" ? Math.ceil(max / 2) : max;
  return {
    memories: memories.slice(0, type === "skill" ? 0 : cap),
    skills: skills.slice(0, type === "memory" ? 0 : cap),
    mode: "keyword",
  };
}

/**
 * @param {{ query: string, type?: "memory"|"skill"|"both", limit?: number, project?: string|null }} opts
 */
export async function recallBrain({ query, type = "both", limit, project = undefined } = {}) {
  const q = String(query ?? "").trim();
  const scope = project === undefined ? null : normalizeBrainProject(project);
  if (!q) {
    return {
      query: q,
      project: projectScopeLabel(scope),
      memories: [],
      skills: [],
      message: "Query is empty.",
      mode: "none",
    };
  }

  const max = Math.min(
    limit ?? config.evolution.recallMaxResults,
    config.evolution.recallMaxResults,
  );
  const queryTokens = tokenize(q);

  let memories = [];
  let skills = [];
  let mode = "keyword";

  if (config.evolution.brainSemantic.enabled) {
    try {
      const semanticHits = await searchBrainSemantic(q, {
        type,
        limit: max * 2,
        project: scope,
      });
      const memoryRows = loadScopedRows("memory", scope);
      const skillRows = loadScopedRows("skill", scope);

      const merged = mergeHybridScores({
        queryTokens,
        semanticHits,
        memoryRows,
        skillRows,
        type,
      });
      memories = merged.memories;
      skills = merged.skills;
      mode = semanticHits.length ? "hybrid" : "keyword";
    } catch (error) {
      console.warn(
        "Semantic brain recall failed, using keyword fallback:",
        error.message,
      );
    }
  }

  if (!memories.length && !skills.length) {
    const fallback = keywordOnlyRecall({ type, max, queryTokens, project: scope });
    memories = fallback.memories;
    skills = fallback.skills;
    mode = fallback.mode;
  } else {
    const cap = type === "both" ? Math.ceil(max / 2) : max;
    memories = memories.slice(0, type === "skill" ? 0 : cap);
    skills = skills.slice(0, type === "memory" ? 0 : cap);
  }

  const total = memories.length + skills.length;
  return {
    query: q,
    project: projectScopeLabel(scope),
    memories,
    skills,
    mode,
    message:
      total === 0
        ? "No matching memories or skills. Try broader keywords or save with remember/learn_skill."
        : `Recalled ${memories.length} memory(ies) and ${skills.length} skill(s) (${mode}).`,
  };
}

export function formatRecallBrainResult(result) {
  const lines = [
    `Recall query: "${result.query}"`,
    `Project scope: ${result.project ?? "global"}`,
    result.message,
    ...(result.mode ? [`Match mode: ${result.mode}`, ""] : [""]),
  ];

  if (result.memories?.length) {
    lines.push("Memories:");
    for (const m of result.memories) {
      lines.push(
        `- [${m.category ?? "note"}] ${m.title} (project: ${projectScopeLabel(m.project)}, importance ${m.importance}, score ${m.score}, ${m.match})`,
      );
      lines.push(`  ${m.content}`);
    }
    lines.push("");
  }

  if (result.skills?.length) {
    lines.push("Skills:");
    for (const s of result.skills) {
      lines.push(
        `- ${s.name}: ${s.description} (project: ${projectScopeLabel(s.project)}, score ${s.score}, ${s.match})`,
      );
      lines.push(`  ${s.instructions}`);
    }
  }

  return lines.join("\n").trim();
}
