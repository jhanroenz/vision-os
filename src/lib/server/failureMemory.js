import { randomUUID, createHash } from "node:crypto";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { normalizeBrainProject } from "./brainProject.js";

export const FAILURE_REASONS = new Set([
  "path_scope",
  "missing_context",
  "plan_order",
  "research_order",
  "verify_fail",
  "hallucinated_path",
  "tool_misuse",
  "env_shell",
  "web_miss",
  "user_correction",
  "gate_blocked",
]);

export const FAILURE_ACTIONS = new Set([
  "caution",
  "prefer_alternative",
  "require_precondition",
]);

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function rowToFailure(row) {
  return {
    id: row.id,
    project: row.project ?? null,
    context: row.context,
    goal: row.goal ?? null,
    attemptedPlan: row.attempted_plan ?? null,
    toolSequence: parseJson(row.tool_sequence_json, []),
    failurePoint: parseJson(row.failure_point_json, {}),
    reasonClassification: row.reason_classification,
    fixStrategy: row.fix_strategy,
    actionType: row.action_type,
    precondition: row.precondition ?? null,
    alternativeHint: row.alternative_hint ?? null,
    applicability: parseJson(row.applicability_json, {}),
    confidence: row.confidence,
    occurrenceCount: row.occurrence_count,
    status: row.status,
    signatureHash: row.signature_hash,
    promptText: row.prompt_text,
    source: row.source,
    sourceConversationId: row.source_conversation_id ?? null,
    enabled: row.enabled === 1,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function summarizeToolArgs(toolName, args = {}) {
  const a = args ?? {};
  if (toolName === "write_file" || toolName === "search_replace" || toolName === "read_file") {
    return String(a.path ?? a.file ?? "").slice(0, 200);
  }
  if (toolName === "run_bash") {
    return String(a.command ?? "").slice(0, 160);
  }
  if (toolName === "web_search") {
    return String(a.query ?? a.q ?? "").slice(0, 160);
  }
  if (toolName === "grep_code" || toolName === "glob_files") {
    return String(a.pattern ?? a.path ?? "").slice(0, 160);
  }
  return JSON.stringify(a).slice(0, 160);
}

export function deriveArgPatterns(toolName, argsSummary) {
  const patterns = [];
  const text = String(argsSummary ?? "").trim();
  if (!text) return patterns;

  if (toolName === "write_file" || toolName === "search_replace" || toolName === "read_file") {
    const normalized = text.replace(/\\/g, "/");
    if (/^src\//i.test(normalized)) patterns.push("^src/");
    const top = normalized.split("/").filter(Boolean)[0];
    if (top && !/^[a-z]:$/i.test(top)) patterns.push(`^${top}/`);
  }

  if (toolName === "run_bash" && /\bnpm\b|\byarn\b|\bpnpm\b/.test(text)) {
    patterns.push("\\b(npm|yarn|pnpm)\\b");
  }

  return [...new Set(patterns)];
}

export function buildFailureSignature({
  project,
  toolName,
  reasonClassification,
  argPatterns = [],
}) {
  const key = [
    normalizeBrainProject(project) ?? "global",
    toolName ?? "",
    reasonClassification ?? "",
    ...(argPatterns ?? []).sort(),
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

export function buildFailurePromptText({
  failurePoint,
  reasonClassification,
  fixStrategy,
  alternativeHint,
  precondition,
}) {
  const tool = failurePoint?.tool ?? "tool";
  const args = failurePoint?.argsSummary ? ` (${failurePoint.argsSummary})` : "";
  const fix = alternativeHint || precondition || fixStrategy || "use a different approach";
  return `${tool}${args} failed (${reasonClassification}) → ${fix}`;
}

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

export function scoreFailureForContext(failure, { userMessage = "", project = null } = {}) {
  if (failure.status !== "active" || !failure.enabled) return 0;

  const scope = normalizeBrainProject(project);
  const failureProject = normalizeBrainProject(failure.project);
  if (failureProject && scope && failureProject !== scope) return 0;
  if (failureProject && !scope) return 0.2;

  let score = (failure.confidence ?? 0.5) * 0.4;
  score += Math.min(0.35, (failure.occurrenceCount ?? 1) * 0.08);

  const ageMs = Date.now() - new Date(failure.lastSeenAt ?? failure.updatedAt).getTime();
  const days = ageMs / (1000 * 60 * 60 * 24);
  if (days <= 7) score += 0.2;
  else if (days <= 30) score += 0.1;

  const queryTokens = tokenize(userMessage);
  if (queryTokens.length) {
    const hay = tokenize(
      [failure.promptText, failure.goal, failure.context, failure.fixStrategy]
        .filter(Boolean)
        .join(" "),
    );
    const haySet = new Set(hay);
    let hits = 0;
    for (const token of queryTokens) {
      if (haySet.has(token)) hits += 1;
    }
    score += (hits / queryTokens.length) * 0.35;
  }

  return score;
}

export function scoreFailureForTool(failure, { toolName, argsSummary, project = null } = {}) {
  if (failure.status !== "active" || !failure.enabled) return 0;
  if (!toolName) return 0;

  const applicability = failure.applicability ?? {};
  const tools = applicability.tools ?? [];
  if (tools.length && !tools.includes(toolName)) return 0;

  const scope = normalizeBrainProject(project);
  const failureProject = normalizeBrainProject(failure.project);
  if (failureProject && scope && failureProject !== scope) return 0;

  let score = 0.45 + Math.min(0.25, (failure.occurrenceCount ?? 1) * 0.05);

  const patterns = applicability.argPatterns ?? [];
  const args = String(argsSummary ?? "");
  if (patterns.length) {
    const matched = patterns.some((pattern) => {
      try {
        return new RegExp(pattern, "i").test(args);
      } catch {
        return args.includes(pattern);
      }
    });
    if (!matched) return 0;
    score += 0.25;
  }

  if (failure.failurePoint?.tool === toolName) score += 0.15;
  return score;
}

export function listFailures({ enabledOnly = false, status = "active" } = {}) {
  const clauses = [];
  const params = [];
  if (enabledOnly) clauses.push("enabled = 1");
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }

  let sql = "SELECT * FROM failure_memories";
  if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
  sql += " ORDER BY occurrence_count DESC, confidence DESC, updated_at DESC";

  return getDb()
    .prepare(sql)
    .all(...params)
    .map(rowToFailure);
}

export function getFailure(id) {
  const row = getDb()
    .prepare("SELECT * FROM failure_memories WHERE id = ?")
    .get(id);
  return row ? rowToFailure(row) : null;
}

export function listFailuresForPrompt(activeProject = null, userMessage = "") {
  const limit = config.evolution.failurePromptMax ?? 3;
  const minScore = config.evolution.failurePromptMinScore ?? 0.35;

  return listFailures({ enabledOnly: true, status: "active" })
    .map((failure) => ({
      failure,
      score: scoreFailureForContext(failure, {
        userMessage,
        project: activeProject,
      }),
    }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ failure }) => failure);
}

export function matchFailuresForTool(toolName, args = {}, { project = null, limit = 2 } = {}) {
  const argsSummary = summarizeToolArgs(toolName, args);
  const minScore = config.evolution.failurePreToolMinScore ?? 0.55;

  return listFailures({ enabledOnly: true, status: "active" })
    .map((failure) => ({
      failure,
      score: scoreFailureForTool(failure, { toolName, argsSummary, project }),
    }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ failure }) => failure);
}

export function upsertFailureMemory(input) {
  const project = normalizeBrainProject(input.project);
  const failurePoint = input.failurePoint ?? {};
  const toolName = failurePoint.tool ?? input.toolName ?? "";
  const argsSummary =
    failurePoint.argsSummary ?? summarizeToolArgs(toolName, input.toolArgs ?? {});
  const reasonClassification = input.reasonClassification;
  if (!FAILURE_REASONS.has(reasonClassification)) {
    throw new Error(`Invalid failure reason: ${reasonClassification}`);
  }

  const actionType = input.actionType ?? "caution";
  if (!FAILURE_ACTIONS.has(actionType)) {
    throw new Error(`Invalid failure action: ${actionType}`);
  }

  const applicability = {
    tools: input.applicability?.tools ?? (toolName ? [toolName] : []),
    argPatterns:
      input.applicability?.argPatterns ??
      deriveArgPatterns(toolName, argsSummary),
    failureClasses: input.applicability?.failureClasses ?? [reasonClassification],
  };

  const signatureHash =
    input.signatureHash ??
    buildFailureSignature({
      project,
      toolName,
      reasonClassification,
      argPatterns: applicability.argPatterns,
    });

  const promptText =
    input.promptText ??
    buildFailurePromptText({
      failurePoint: { ...failurePoint, argsSummary },
      reasonClassification,
      fixStrategy: input.fixStrategy,
      alternativeHint: input.alternativeHint,
      precondition: input.precondition,
    });

  const now = nowIso();
  const existing = getDb()
    .prepare("SELECT * FROM failure_memories WHERE signature_hash = ?")
    .get(signatureHash);

  if (existing) {
    const occurrence = existing.occurrence_count + 1;
    const confidence = Math.min(0.95, (existing.confidence ?? 0.6) + 0.08);
    getDb()
      .prepare(
        `UPDATE failure_memories SET
          occurrence_count = ?,
          confidence = ?,
          last_seen_at = ?,
          updated_at = ?,
          prompt_text = ?,
          fix_strategy = ?,
          precondition = COALESCE(?, precondition),
          alternative_hint = COALESCE(?, alternative_hint),
          status = 'active',
          enabled = 1
         WHERE id = ?`,
      )
      .run(
        occurrence,
        confidence,
        now,
        now,
        promptText,
        input.fixStrategy ?? existing.fix_strategy,
        input.precondition ?? null,
        input.alternativeHint ?? null,
        existing.id,
      );
    return getFailure(existing.id);
  }

  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO failure_memories (
        id, project, context, goal, attempted_plan, tool_sequence_json,
        failure_point_json, reason_classification, fix_strategy, action_type,
        precondition, alternative_hint, applicability_json, confidence,
        occurrence_count, status, signature_hash, prompt_text, source,
        source_conversation_id, enabled, last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      project,
      input.context ?? "",
      input.goal ?? null,
      input.attemptedPlan ?? null,
      JSON.stringify(input.toolSequence ?? []),
      JSON.stringify({ ...failurePoint, tool: toolName, argsSummary }),
      reasonClassification,
      input.fixStrategy ?? "",
      actionType,
      input.precondition ?? null,
      input.alternativeHint ?? null,
      JSON.stringify(applicability),
      input.confidence ?? 0.6,
      1,
      input.status ?? "active",
      signatureHash,
      promptText,
      input.source ?? "agent",
      input.sourceConversationId ?? null,
      input.enabled === false ? 0 : 1,
      now,
      now,
      now,
    );

  return getFailure(id);
}

export function patchFailure(id, patch) {
  const existing = getFailure(id);
  if (!existing) throw new Error("Failure memory not found");

  const fields = [];
  const values = [];
  const allowed = {
    context: "context",
    goal: "goal",
    fixStrategy: "fix_strategy",
    actionType: "action_type",
    precondition: "precondition",
    alternativeHint: "alternative_hint",
    status: "status",
    enabled: "enabled",
    promptText: "prompt_text",
  };

  for (const [key, column] of Object.entries(allowed)) {
    if (patch[key] !== undefined) {
      fields.push(`${column} = ?`);
      if (key === "enabled") values.push(patch[key] ? 1 : 0);
      else values.push(patch[key]);
    }
  }

  if (!fields.length) return existing;

  fields.push("updated_at = ?");
  values.push(nowIso(), id);

  getDb()
    .prepare(`UPDATE failure_memories SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values);

  return getFailure(id);
}

export function deleteFailure(id) {
  getDb().prepare("DELETE FROM failure_memories WHERE id = ?").run(id);
}
