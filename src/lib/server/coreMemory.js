import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { compressMemoryForPrompt, memoryPromptBody } from "./compress.js";
import { indexMemoryRow, removeMemoryFromIndex } from "./brainIndex.js";
import { normalizeBrainProject } from "./brainProject.js";

const CATEGORIES = new Set(["preference", "project", "fact", "workflow", "fix"]);

function normalizeKey(text) {
  return text.trim().toLowerCase();
}

function rowToMemory(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    promptText: row.prompt_text ?? null,
    category: row.category,
    project: row.project ?? null,
    source: row.source,
    sourceConversationId: row.source_conversation_id,
    importance: row.importance,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function indexRowFromMemory(memory, promptText) {
  return {
    id: memory.id,
    title: memory.title,
    content: memory.content,
    prompt_text: promptText ?? memory.promptText,
    category: memory.category,
    importance: memory.importance,
    project: memory.project,
  };
}

export function listMemories({ enabledOnly = false, project = undefined } = {}) {
  const clauses = [];
  const params = [];

  if (enabledOnly) {
    clauses.push("enabled = 1");
  }
  if (project !== undefined) {
    const scope = normalizeBrainProject(project);
    if (scope) {
      clauses.push("(project IS NULL OR project = ?)");
      params.push(scope);
    } else {
      clauses.push("project IS NULL");
    }
  }

  let sql = "SELECT * FROM core_memories";
  if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
  sql += " ORDER BY importance DESC, updated_at DESC";

  return getDb().prepare(sql).all(...params).map(rowToMemory);
}

export function listMemoriesForPrompt(activeProject = null) {
  const minImportance = config.evolution.promptMinImportance;
  const limit = config.evolution.promptMaxMemories;
  const scope = normalizeBrainProject(activeProject);

  const rows = scope
    ? getDb()
        .prepare(
          `SELECT * FROM core_memories
           WHERE enabled = 1 AND importance >= ?
           AND (project IS NULL OR project = ?)
           ORDER BY CASE WHEN project = ? THEN 0 ELSE 1 END,
                    importance DESC, updated_at DESC
           LIMIT ?`,
        )
        .all(minImportance, scope, scope, limit)
    : getDb()
        .prepare(
          `SELECT * FROM core_memories
           WHERE enabled = 1 AND importance >= ? AND project IS NULL
           ORDER BY importance DESC, updated_at DESC
           LIMIT ?`,
        )
        .all(minImportance, limit);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    importance: row.importance,
    project: row.project ?? null,
  }));
}

export function getMemory(id) {
  const row = getDb()
    .prepare(`SELECT * FROM core_memories WHERE id = ?`)
    .get(id);
  return row ? rowToMemory(row) : null;
}

export function findMemoryByTitle(title, { project = undefined } = {}) {
  const key = normalizeKey(title);
  const scope = project === undefined ? undefined : normalizeBrainProject(project);
  const rows = getDb().prepare(`SELECT * FROM core_memories`).all();
  return (
    rows.find((r) => {
      if (normalizeKey(r.title) !== key) return false;
      if (scope === undefined) return true;
      const rowProject = normalizeBrainProject(r.project);
      return rowProject === scope;
    }) ?? null
  );
}

export async function upsertMemory({
  title,
  content,
  category = null,
  project = undefined,
  source = "agent",
  sourceConversationId = null,
  importance = 3,
  enabled = true,
}) {
  if (!title?.trim() || !content?.trim()) {
    throw new Error("title and content are required");
  }

  const imp = Math.min(5, Math.max(1, Number(importance) || 3));
  const cat = category && CATEGORIES.has(category) ? category : null;
  const projectScope =
    project === undefined ? null : normalizeBrainProject(project);
  const now = new Date().toISOString();
  const trimmedTitle = title.trim();
  const trimmedContent = content.trim();
  const promptText = await compressMemoryForPrompt({
    title: trimmedTitle,
    content: trimmedContent,
    category: cat,
  });
  const existing = findMemoryByTitle(trimmedTitle, { project: projectScope });

  if (existing) {
    getDb()
      .prepare(
        `UPDATE core_memories
         SET title = @title, content = @content, prompt_text = @prompt_text,
             category = @category, project = @project, source = @source,
             source_conversation_id = @source_conversation_id,
             importance = @importance, enabled = @enabled, updated_at = @updated_at
         WHERE id = @id`,
      )
      .run({
        id: existing.id,
        title: trimmedTitle,
        content: trimmedContent,
        prompt_text: promptText,
        category: cat,
        project: projectScope,
        source,
        source_conversation_id: sourceConversationId,
        importance: imp,
        enabled: enabled ? 1 : 0,
        updated_at: now,
      });
    const saved = getMemory(existing.id);
    void indexMemoryRow(indexRowFromMemory(saved, promptText));
    return saved;
  }

  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO core_memories
       (id, title, content, prompt_text, category, project, source, source_conversation_id,
        importance, enabled, created_at, updated_at)
       VALUES
       (@id, @title, @content, @prompt_text, @category, @project, @source, @source_conversation_id,
        @importance, @enabled, @created_at, @updated_at)`,
    )
    .run({
      id,
      title: trimmedTitle,
      content: trimmedContent,
      prompt_text: promptText,
      category: cat,
      project: projectScope,
      source,
      source_conversation_id: sourceConversationId,
      importance: imp,
      enabled: enabled ? 1 : 0,
      created_at: now,
      updated_at: now,
    });

  const saved = getMemory(id);
  void indexMemoryRow(indexRowFromMemory(saved, promptText));
  return saved;
}

export async function createMemory(fields) {
  return upsertMemory({ ...fields, source: fields.source ?? "user" });
}

export async function updateMemory(id, fields) {
  const existing = getMemory(id);
  if (!existing) throw new Error("Memory not found");

  const now = new Date().toISOString();
  const title = (fields.title ?? existing.title).trim();
  const content = (fields.content ?? existing.content).trim();
  const category =
    fields.category !== undefined
      ? fields.category && CATEGORIES.has(fields.category)
        ? fields.category
        : null
      : existing.category;
  const project =
    fields.project !== undefined
      ? normalizeBrainProject(fields.project)
      : existing.project;
  const importance = Math.min(
    5,
    Math.max(1, Number(fields.importance ?? existing.importance) || 3),
  );
  const enabled =
    fields.enabled !== undefined ? (fields.enabled ? 1 : 0) : existing.enabled ? 1 : 0;

  const contentChanged =
    title !== existing.title ||
    content !== existing.content ||
    category !== existing.category ||
    project !== existing.project;
  const promptText = contentChanged
    ? await compressMemoryForPrompt({ title, content, category })
    : existing.promptText;

  getDb()
    .prepare(
      `UPDATE core_memories
       SET title = @title, content = @content, prompt_text = @prompt_text,
           category = @category, project = @project, importance = @importance,
           enabled = @enabled, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id,
      title,
      content,
      prompt_text: promptText,
      category,
      project,
      importance,
      enabled,
      updated_at: now,
    });

  const updated = getMemory(id);
  if (updated.enabled) {
    void indexMemoryRow(indexRowFromMemory(updated, promptText));
  } else {
    void removeMemoryFromIndex(id);
  }
  return updated;
}

export function deleteMemory(id) {
  const result = getDb()
    .prepare(`DELETE FROM core_memories WHERE id = ?`)
    .run(id);
  if (result.changes > 0) void removeMemoryFromIndex(id);
  return result.changes > 0;
}

export async function recompressAllMemories() {
  const rows = getDb().prepare(`SELECT * FROM core_memories`).all();
  let updated = 0;
  for (const row of rows) {
    const promptText = await compressMemoryForPrompt({
      title: row.title,
      content: row.content,
      category: row.category,
    });
    getDb()
      .prepare(`UPDATE core_memories SET prompt_text = @prompt_text WHERE id = @id`)
      .run({ id: row.id, prompt_text: promptText });
    updated++;
  }
  return { updated };
}

export { memoryPromptBody };
