import { getDb } from "./db.js";
import { getSeedDefaults } from "./seedDefaults.js";

const SETTINGS_ROW_ID = 1;

export function migrateAppSettingsTable() {
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'")
    .all();
  if (tables.length) {
    const cols = db.prepare("PRAGMA table_info(app_settings)").all();
    const hasPayload = cols.some((c) => c.name === "payload");
    if (!hasPayload) {
      db.exec("DROP TABLE app_settings");
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 1,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function loadAppSettings() {
  migrateAppSettingsTable();
  const row = getDb()
    .prepare("SELECT version, payload, updated_at FROM app_settings WHERE id = ?")
    .get(SETTINGS_ROW_ID);
  if (!row) return null;
  try {
    return {
      version: row.version,
      payload: JSON.parse(row.payload),
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export function saveAppSettings(payload, { version = 1 } = {}) {
  migrateAppSettingsTable();
  const updatedAt = new Date().toISOString();
  const json = JSON.stringify(payload);
  getDb()
    .prepare(
      `INSERT INTO app_settings (id, version, payload, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         version = excluded.version,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
    )
    .run(SETTINGS_ROW_ID, version, json, updatedAt);
  return { updatedAt, version };
}

export function seedAppSettingsIfEmpty() {
  migrateAppSettingsTable();
  const existing = getDb()
    .prepare("SELECT id FROM app_settings WHERE id = ?")
    .get(SETTINGS_ROW_ID);
  if (existing) return { seeded: false };

  const defaults = getSeedDefaults();
  const { updatedAt } = saveAppSettings(defaults);
  return { seeded: true, payload: defaults, updatedAt };
}

export function deleteAppSettings() {
  migrateAppSettingsTable();
  getDb().prepare("DELETE FROM app_settings WHERE id = ?").run(SETTINGS_ROW_ID);
}
