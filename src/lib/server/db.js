import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";
import { migrateAppSettingsTable } from "./appSettingsDb.js";

let db;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    cwd TEXT NOT NULL DEFAULT '.',
    compact_summary TEXT
  );

  CREATE TABLE IF NOT EXISTS ui_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tools TEXT,
    compact INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS llm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT,
    tool_calls TEXT,
    tool_call_id TEXT,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_ui_messages_conv
    ON ui_messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_llm_messages_conv
    ON llm_messages(conversation_id, position);

  CREATE TABLE IF NOT EXISTS core_memories (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    source TEXT NOT NULL DEFAULT 'agent',
    source_conversation_id TEXT,
    importance INTEGER NOT NULL DEFAULT 3,
    enabled INTEGER NOT NULL DEFAULT 1,
    prompt_text TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    instructions TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'agent',
    source_conversation_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    prompt_text TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_core_memories_enabled
    ON core_memories(enabled, importance DESC, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_skills_enabled
    ON skills(enabled, updated_at DESC);

  CREATE TABLE IF NOT EXISTS failure_memories (
    id TEXT PRIMARY KEY,
    project TEXT,
    context TEXT NOT NULL,
    goal TEXT,
    attempted_plan TEXT,
    tool_sequence_json TEXT,
    failure_point_json TEXT NOT NULL,
    reason_classification TEXT NOT NULL,
    fix_strategy TEXT NOT NULL,
    action_type TEXT NOT NULL DEFAULT 'caution',
    precondition TEXT,
    alternative_hint TEXT,
    applicability_json TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.6,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    signature_hash TEXT NOT NULL UNIQUE,
    prompt_text TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'agent',
    source_conversation_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_seen_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_failure_memories_active
    ON failure_memories(enabled, status, project, updated_at DESC);
`;

export function getDb() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

export async function initDatabase() {
  await fs.mkdir(path.dirname(config.dbPath), { recursive: true });

  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");
  db.exec(SCHEMA);

  migrateEvolutionColumns();
  migrateBrainProjectColumn();
  migrateFailureMemoriesTable();
  migrateProjectRootColumn();
  migrateWorkspaceRootSourceColumn();
  migrateResearchSessionsTable();
  migrateCursorAgentIdColumn();
  migrateAppSettingsTable();
  migrateUserAppsTables();
  await migrateJsonConversations();
  await migrateConversationCwdSanitize();
  return db;
}

function migrateProjectRootColumn() {
  const cols = getDb()
    .prepare("PRAGMA table_info(conversations)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("project_root")) {
    getDb().exec("ALTER TABLE conversations ADD COLUMN project_root TEXT");
  }
  getDb()
    .prepare(
      `UPDATE conversations SET project_root = '.'
       WHERE project_root IS NULL OR trim(project_root) = ''`,
    )
    .run();
}

function migrateCursorAgentIdColumn() {
  const cols = getDb()
    .prepare("PRAGMA table_info(conversations)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("cursor_agent_id")) {
    getDb().exec("ALTER TABLE conversations ADD COLUMN cursor_agent_id TEXT");
  }
}

function migrateWorkspaceRootSourceColumn() {
  const cols = getDb()
    .prepare("PRAGMA table_info(conversations)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("workspace_root_source")) {
    getDb().exec(
      "ALTER TABLE conversations ADD COLUMN workspace_root_source TEXT NOT NULL DEFAULT 'default'",
    );
  }
  getDb()
    .prepare(
      `UPDATE conversations SET workspace_root_source = 'default'
       WHERE workspace_root_source IS NULL OR trim(workspace_root_source) = ''`,
    )
    .run();
}

function migrateEvolutionColumns() {
  const memoryCols = getDb()
    .prepare("PRAGMA table_info(core_memories)")
    .all()
    .map((c) => c.name);
  if (!memoryCols.includes("prompt_text")) {
    getDb().exec("ALTER TABLE core_memories ADD COLUMN prompt_text TEXT");
  }

  const skillCols = getDb()
    .prepare("PRAGMA table_info(skills)")
    .all()
    .map((c) => c.name);
  if (!skillCols.includes("prompt_text")) {
    getDb().exec("ALTER TABLE skills ADD COLUMN prompt_text TEXT");
  }

  // Safe bootstrap backfill so existing installations immediately benefit
  // even before explicit recompression is run.
  getDb()
    .prepare(
      `UPDATE core_memories
       SET prompt_text = substr(trim(title || ': ' || content), 1, ?)
       WHERE (prompt_text IS NULL OR trim(prompt_text) = '')
         AND title IS NOT NULL
         AND content IS NOT NULL`,
    )
    .run(config.evolution.compressMaxChars);

  getDb()
    .prepare(
      `UPDATE skills
       SET prompt_text = substr(trim(name || ': ' || description || '. ' || instructions), 1, ?)
       WHERE (prompt_text IS NULL OR trim(prompt_text) = '')
         AND name IS NOT NULL
         AND description IS NOT NULL
         AND instructions IS NOT NULL`,
    )
    .run(config.evolution.compressMaxChars);
}

function migrateFailureMemoriesTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS failure_memories (
      id TEXT PRIMARY KEY,
      project TEXT,
      context TEXT NOT NULL,
      goal TEXT,
      attempted_plan TEXT,
      tool_sequence_json TEXT,
      failure_point_json TEXT NOT NULL,
      reason_classification TEXT NOT NULL,
      fix_strategy TEXT NOT NULL,
      action_type TEXT NOT NULL DEFAULT 'caution',
      precondition TEXT,
      alternative_hint TEXT,
      applicability_json TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.6,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      signature_hash TEXT NOT NULL UNIQUE,
      prompt_text TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'agent',
      source_conversation_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_failure_memories_active
      ON failure_memories(enabled, status, project, updated_at DESC);
  `);
}

function migrateBrainProjectColumn() {
  const memoryCols = getDb()
    .prepare("PRAGMA table_info(core_memories)")
    .all()
    .map((c) => c.name);
  if (!memoryCols.includes("project")) {
    getDb().exec("ALTER TABLE core_memories ADD COLUMN project TEXT");
  }

  const skillCols = getDb()
    .prepare("PRAGMA table_info(skills)")
    .all()
    .map((c) => c.name);
  if (!skillCols.includes("project")) {
    getDb().exec("ALTER TABLE skills ADD COLUMN project TEXT");
  }

  getDb().exec(`
    CREATE INDEX IF NOT EXISTS idx_core_memories_project
      ON core_memories(enabled, project, importance DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_skills_project
      ON skills(enabled, project, updated_at DESC);
  `);
}

function migrateUserAppsTables() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS user_apps (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '📦',
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      published_at INTEGER,
      updated_at INTEGER NOT NULL,
      default_width INTEGER,
      default_height INTEGER,
      launcher INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_user_apps_status
      ON user_apps(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS app_data (
      app_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (app_id, key),
      FOREIGN KEY (app_id) REFERENCES user_apps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_jobs (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      name TEXT NOT NULL,
      schedule TEXT NOT NULL,
      handler TEXT NOT NULL,
      payload_json TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      next_run_at INTEGER,
      last_error TEXT,
      FOREIGN KEY (app_id) REFERENCES user_apps(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_app_jobs_next
      ON app_jobs(enabled, next_run_at);
  `);
}

async function migrateConversationCwdSanitize() {
  const { sanitizeWorkspaceRelativePath } = await import("./workspace.js");
  const rows = getDb()
    .prepare("SELECT id, cwd FROM conversations")
    .all();

  const update = getDb().prepare(
    "UPDATE conversations SET cwd = ? WHERE id = ?",
  );

  for (const row of rows) {
    const safe = sanitizeWorkspaceRelativePath(row.cwd ?? ".");
    if (safe !== row.cwd) {
      update.run(safe, row.id);
    }
  }
}

function researchSessionsV2Sql() {
  return `
    CREATE TABLE research_sessions (
      id TEXT PRIMARY KEY,
      user_query TEXT NOT NULL,
      title TEXT,
      tier TEXT NOT NULL,
      status TEXT NOT NULL,
      plan_json TEXT,
      report_markdown TEXT,
      report_json TEXT,
      source_count INTEGER DEFAULT 0,
      search_count INTEGER DEFAULT 0,
      token_estimate INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_research_sessions_created
      ON research_sessions(created_at DESC);
  `;
}

function titleFromUserQuerySql() {
  return `CASE
    WHEN length(user_query) > 60 THEN substr(user_query, 1, 59) || '…'
    ELSE user_query
  END`;
}

function migrateResearchSessionsTable() {
  const table = getDb()
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'research_sessions'",
    )
    .get();

  if (!table) {
    getDb().exec(researchSessionsV2Sql());
    return;
  }

  const cols = getDb().prepare("PRAGMA table_info(research_sessions)").all();
  const colNames = cols.map((c) => c.name);
  const conversationCol = cols.find((c) => c.name === "conversation_id");
  const needsRebuild =
    conversationCol != null || !colNames.includes("title");

  if (!needsRebuild) return;

  getDb().exec(`
    CREATE TABLE research_sessions_v2 (
      id TEXT PRIMARY KEY,
      user_query TEXT NOT NULL,
      title TEXT,
      tier TEXT NOT NULL,
      status TEXT NOT NULL,
      plan_json TEXT,
      report_markdown TEXT,
      report_json TEXT,
      source_count INTEGER DEFAULT 0,
      search_count INTEGER DEFAULT 0,
      token_estimate INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `);

  const titleSelect = colNames.includes("title")
    ? `COALESCE(title, ${titleFromUserQuerySql()})`
    : titleFromUserQuerySql();

  getDb().exec(`
    INSERT INTO research_sessions_v2 (
      id, user_query, title, tier, status, plan_json,
      report_markdown, report_json, source_count, search_count,
      token_estimate, error, created_at, completed_at
    )
    SELECT
      id, user_query, ${titleSelect}, tier, status, plan_json,
      report_markdown, report_json, source_count, search_count,
      token_estimate, error, created_at, completed_at
    FROM research_sessions
  `);

  getDb().exec("DROP TABLE research_sessions");
  getDb().exec("ALTER TABLE research_sessions_v2 RENAME TO research_sessions");
  getDb().exec(`
    CREATE INDEX IF NOT EXISTS idx_research_sessions_created
      ON research_sessions(created_at DESC);
  `);
}

async function migrateJsonConversations() {
  const dir = config.conversationsDir;
  let files = [];

  try {
    files = await fs.readdir(dir);
  } catch {
    return;
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  if (jsonFiles.length === 0) return;

  const exists = getDb().prepare(
    "SELECT COUNT(*) AS count FROM conversations",
  ).get();

  if (exists.count > 0) return;

  const insertConv = getDb().prepare(`
    INSERT INTO conversations (id, title, created_at, updated_at, cwd, compact_summary)
    VALUES (@id, @title, @created_at, @updated_at, @cwd, @compact_summary)
  `);

  const insertUi = getDb().prepare(`
    INSERT INTO ui_messages (id, conversation_id, role, content, tools, compact, created_at)
    VALUES (@id, @conversation_id, @role, @content, @tools, @compact, @created_at)
  `);

  const insertLlm = getDb().prepare(`
    INSERT INTO llm_messages (conversation_id, position, role, content, tool_calls, tool_call_id)
    VALUES (@conversation_id, @position, @role, @content, @tool_calls, @tool_call_id)
  `);

  const migrateAll = getDb().transaction((items) => {
    for (const conv of items) {
      insertConv.run({
        id: conv.id,
        title: conv.title,
        created_at: conv.createdAt,
        updated_at: conv.updatedAt,
        cwd: conv.cwd ?? ".",
        compact_summary: conv.compactSummary ?? null,
      });

      for (const msg of conv.uiMessages ?? []) {
        insertUi.run({
          id: msg.id,
          conversation_id: conv.id,
          role: msg.role,
          content: msg.content,
          tools: msg.tools ? JSON.stringify(msg.tools) : null,
          compact: msg.compact ? 1 : 0,
          created_at: msg.createdAt ?? new Date().toISOString(),
        });
      }

      (conv.llmMessages ?? []).forEach((msg, index) => {
        insertLlm.run({
          conversation_id: conv.id,
          position: index,
          role: msg.role,
          content: msg.content ?? null,
          tool_calls: msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
          tool_call_id: msg.tool_call_id ?? null,
        });
      });
    }
  });

  const items = [];
  for (const file of jsonFiles) {
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf-8");
      items.push(JSON.parse(raw));
    } catch {
      // skip corrupt files
    }
  }

  if (items.length > 0) {
    migrateAll(items);
    const migratedDir = path.join(dir, ".migrated");
    await fs.mkdir(migratedDir, { recursive: true });
    for (const file of jsonFiles) {
      await fs.rename(path.join(dir, file), path.join(migratedDir, file));
    }
    console.log(`Migrated ${items.length} conversation(s) from JSON to SQLite`);
  }
}
