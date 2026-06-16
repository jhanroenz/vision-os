import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";

export function titleFromQuery(query, maxLen = 60) {
  const text = String(query ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return "Research";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function rowToSession(row) {
  return {
    id: row.id,
    title: row.title ?? titleFromQuery(row.user_query),
    userQuery: row.user_query,
    tier: row.tier,
    status: row.status,
    plan: row.plan_json ? JSON.parse(row.plan_json) : null,
    reportMarkdown: row.report_markdown,
    reportJson: row.report_json ? JSON.parse(row.report_json) : null,
    sourceCount: row.source_count,
    searchCount: row.search_count,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function createResearchSession({
  id,
  userQuery,
  tier,
  plan,
  title,
}) {
  const sessionId = id ?? randomUUID();
  const now = Date.now();
  const sessionTitle = title ?? titleFromQuery(userQuery);
  getDb()
    .prepare(
      `INSERT INTO research_sessions (
        id, user_query, title, tier, status, plan_json,
        source_count, search_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
    )
    .run(
      sessionId,
      userQuery,
      sessionTitle,
      tier,
      "planning",
      JSON.stringify(plan ?? null),
      now,
    );
  return { id: sessionId, title: sessionTitle, createdAt: now };
}

export function updateResearchSession(id, patch) {
  const fields = [];
  const values = [];

  const allowed = [
    "status",
    "plan_json",
    "report_markdown",
    "report_json",
    "source_count",
    "search_count",
    "token_estimate",
    "error",
    "completed_at",
    "title",
  ];

  for (const key of allowed) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(patch[key]);
    }
  }

  if (!fields.length) return;
  values.push(id);
  getDb()
    .prepare(`UPDATE research_sessions SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values);
}

export function getResearchSession(id) {
  const row = getDb()
    .prepare("SELECT * FROM research_sessions WHERE id = ?")
    .get(id);
  if (!row) return null;
  return rowToSession(row);
}

export function listResearchSessions() {
  const rows = getDb()
    .prepare(
      `SELECT id, title, user_query, tier, status, source_count, search_count,
              created_at, completed_at,
              CASE
                WHEN report_markdown IS NOT NULL THEN substr(report_markdown, 1, 120)
                ELSE substr(user_query, 1, 120)
              END AS preview
       FROM research_sessions
       ORDER BY COALESCE(completed_at, created_at) DESC`,
    )
    .all();

  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? titleFromQuery(row.user_query),
    userQuery: row.user_query,
    tier: row.tier,
    status: row.status,
    sourceCount: row.source_count,
    searchCount: row.search_count,
    preview: row.preview ?? "",
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}

export function deleteResearchSession(id) {
  getDb().prepare("DELETE FROM research_sessions WHERE id = ?").run(id);
}

export function updateResearchSessionTitle(id, title) {
  const trimmed = String(title ?? "").trim();
  if (!trimmed) throw new Error("Title is required");
  updateResearchSession(id, { title: trimmed });
  return { id, title: trimmed };
}
