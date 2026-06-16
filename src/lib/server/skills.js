import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { compressSkillForPrompt, skillPromptBody } from "./compress.js";
import { indexSkillRow, removeSkillFromIndex } from "./brainIndex.js";
import { normalizeBrainProject } from "./brainProject.js";

function normalizeKey(text) {
  return text.trim().toLowerCase();
}

function rowToSkill(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    promptText: row.prompt_text ?? null,
    project: row.project ?? null,
    source: row.source,
    sourceConversationId: row.source_conversation_id,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function indexRowFromSkill(skill, promptText) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    prompt_text: promptText ?? skill.promptText,
    project: skill.project,
  };
}

export function listSkills({ enabledOnly = false, project = undefined } = {}) {
  const clauses = [];
  const params = [];

  if (enabledOnly) clauses.push("enabled = 1");
  if (project !== undefined) {
    const scope = normalizeBrainProject(project);
    if (scope) {
      clauses.push("(project IS NULL OR project = ?)");
      params.push(scope);
    } else {
      clauses.push("project IS NULL");
    }
  }

  let sql = "SELECT * FROM skills";
  if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
  sql += " ORDER BY updated_at DESC";

  return getDb().prepare(sql).all(...params).map(rowToSkill);
}

export function listSkillsForPrompt(activeProject = null) {
  const limit = config.evolution.promptMaxSkills;
  const scope = normalizeBrainProject(activeProject);

  const rows = scope
    ? getDb()
        .prepare(
          `SELECT id, name, description, project FROM skills
           WHERE enabled = 1 AND (project IS NULL OR project = ?)
           ORDER BY CASE WHEN project = ? THEN 0 ELSE 1 END,
                    updated_at DESC
           LIMIT ?`,
        )
        .all(scope, scope, limit)
    : getDb()
        .prepare(
          `SELECT id, name, description, project FROM skills
           WHERE enabled = 1 AND project IS NULL
           ORDER BY updated_at DESC
           LIMIT ?`,
        )
        .all(limit);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    project: row.project ?? null,
  }));
}

export function getSkill(id) {
  const row = getDb().prepare(`SELECT * FROM skills WHERE id = ?`).get(id);
  return row ? rowToSkill(row) : null;
}

export function findSkillByName(name, { project = undefined } = {}) {
  const key = normalizeKey(name);
  const scope = project === undefined ? undefined : normalizeBrainProject(project);
  const rows = getDb().prepare(`SELECT * FROM skills`).all();
  return (
    rows.find((r) => {
      if (normalizeKey(r.name) !== key) return false;
      if (scope === undefined) return true;
      return normalizeBrainProject(r.project) === scope;
    }) ?? null
  );
}

export async function upsertSkill({
  name,
  description,
  instructions,
  project = undefined,
  source = "agent",
  sourceConversationId = null,
  enabled = true,
}) {
  if (!name?.trim() || !description?.trim() || !instructions?.trim()) {
    throw new Error("name, description, and instructions are required");
  }

  const now = new Date().toISOString();
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const trimmedInstructions = instructions.trim();
  const projectScope =
    project === undefined ? null : normalizeBrainProject(project);
  const promptText = await compressSkillForPrompt({
    name: trimmedName,
    description: trimmedDescription,
    instructions: trimmedInstructions,
  });
  const existing = findSkillByName(trimmedName, { project: projectScope });

  if (existing) {
    getDb()
      .prepare(
        `UPDATE skills
         SET name = @name, description = @description, instructions = @instructions,
             prompt_text = @prompt_text, project = @project, source = @source,
             source_conversation_id = @source_conversation_id,
             enabled = @enabled, updated_at = @updated_at
         WHERE id = @id`,
      )
      .run({
        id: existing.id,
        name: trimmedName,
        description: trimmedDescription,
        instructions: trimmedInstructions,
        prompt_text: promptText,
        project: projectScope,
        source,
        source_conversation_id: sourceConversationId,
        enabled: enabled ? 1 : 0,
        updated_at: now,
      });
    const saved = getSkill(existing.id);
    void indexSkillRow(indexRowFromSkill(saved, promptText));
    return saved;
  }

  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO skills
       (id, name, description, instructions, prompt_text, project, source,
        source_conversation_id, enabled, created_at, updated_at)
       VALUES
       (@id, @name, @description, @instructions, @prompt_text, @project, @source,
        @source_conversation_id, @enabled, @created_at, @updated_at)`,
    )
    .run({
      id,
      name: trimmedName,
      description: trimmedDescription,
      instructions: trimmedInstructions,
      prompt_text: promptText,
      project: projectScope,
      source,
      source_conversation_id: sourceConversationId,
      enabled: enabled ? 1 : 0,
      created_at: now,
      updated_at: now,
    });

  const saved = getSkill(id);
  void indexSkillRow(indexRowFromSkill(saved, promptText));
  return saved;
}

export async function createSkill(fields) {
  return upsertSkill({ ...fields, source: fields.source ?? "user" });
}

export async function updateSkill(id, fields) {
  const existing = getSkill(id);
  if (!existing) throw new Error("Skill not found");

  const now = new Date().toISOString();
  const name = (fields.name ?? existing.name).trim();
  const description = (fields.description ?? existing.description).trim();
  const instructions = (fields.instructions ?? existing.instructions).trim();
  const project =
    fields.project !== undefined
      ? normalizeBrainProject(fields.project)
      : existing.project;
  const enabled =
    fields.enabled !== undefined ? (fields.enabled ? 1 : 0) : existing.enabled ? 1 : 0;

  const contentChanged =
    name !== existing.name ||
    description !== existing.description ||
    instructions !== existing.instructions ||
    project !== existing.project;
  const promptText = contentChanged
    ? await compressSkillForPrompt({ name, description, instructions })
    : existing.promptText;

  getDb()
    .prepare(
      `UPDATE skills
       SET name = @name, description = @description, instructions = @instructions,
           prompt_text = @prompt_text, project = @project, enabled = @enabled,
           updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id,
      name,
      description,
      instructions,
      prompt_text: promptText,
      project,
      enabled,
      updated_at: now,
    });

  const updated = getSkill(id);
  if (updated.enabled) {
    void indexSkillRow(indexRowFromSkill(updated, promptText));
  } else {
    void removeSkillFromIndex(id);
  }
  return updated;
}

export function deleteSkill(id) {
  const result = getDb().prepare(`DELETE FROM skills WHERE id = ?`).run(id);
  if (result.changes > 0) void removeSkillFromIndex(id);
  return result.changes > 0;
}

export async function recompressAllSkills() {
  const rows = getDb().prepare(`SELECT * FROM skills`).all();
  let updated = 0;
  for (const row of rows) {
    const promptText = await compressSkillForPrompt({
      name: row.name,
      description: row.description,
      instructions: row.instructions,
    });
    getDb()
      .prepare(`UPDATE skills SET prompt_text = @prompt_text WHERE id = @id`)
      .run({ id: row.id, prompt_text: promptText });
    updated++;
  }
  return { updated };
}

export { skillPromptBody };
