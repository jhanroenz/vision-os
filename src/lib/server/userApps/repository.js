import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { registryIdFromSlug } from "./paths.js";

function rowToApp(row) {
  const manifest = row.manifest_json ? JSON.parse(row.manifest_json) : null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    icon: row.icon,
    type: row.type,
    status: row.status,
    source: row.source,
    manifest,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    launcher: row.launcher !== 0,
    defaultWidth: row.default_width ?? manifest?.defaultWidth,
    defaultHeight: row.default_height ?? manifest?.defaultHeight,
  };
}

export function upsertUserApp({
  slug,
  name,
  icon,
  type,
  status,
  source,
  manifestJson,
  publishedAt = null,
  defaultWidth = null,
  defaultHeight = null,
  launcher = 1,
}) {
  const id = registryIdFromSlug(slug);
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO user_apps (
        id, slug, name, icon, type, status, source, manifest_json,
        published_at, updated_at, default_width, default_height, launcher
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        icon = excluded.icon,
        type = excluded.type,
        status = excluded.status,
        source = excluded.source,
        manifest_json = excluded.manifest_json,
        published_at = excluded.published_at,
        updated_at = excluded.updated_at,
        default_width = excluded.default_width,
        default_height = excluded.default_height,
        launcher = excluded.launcher`,
    )
    .run(
      id,
      slug,
      name,
      icon,
      type,
      status,
      source,
      manifestJson,
      publishedAt,
      now,
      defaultWidth,
      defaultHeight,
      launcher ? 1 : 0,
    );
  return getUserAppBySlug(slug);
}

export function getUserAppBySlug(slug) {
  const row = getDb()
    .prepare("SELECT * FROM user_apps WHERE slug = ?")
    .get(slug);
  return row ? rowToApp(row) : null;
}

export function getUserAppById(id) {
  const row = getDb().prepare("SELECT * FROM user_apps WHERE id = ?").get(id);
  return row ? rowToApp(row) : null;
}

export function listUserApps({ status, source } = {}) {
  let sql = "SELECT * FROM user_apps WHERE 1=1";
  const params = [];
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (source) {
    sql += " AND source = ?";
    params.push(source);
  }
  sql += " ORDER BY updated_at DESC";
  return getDb()
    .prepare(sql)
    .all(...params)
    .map(rowToApp);
}

export function deleteUserApp(slug) {
  const id = registryIdFromSlug(slug);
  getDb().prepare("DELETE FROM app_data WHERE app_id = ?").run(id);
  getDb().prepare("DELETE FROM app_jobs WHERE app_id = ?").run(id);
  const result = getDb().prepare("DELETE FROM user_apps WHERE slug = ?").run(slug);
  return result.changes > 0;
}

export function getAppData(appId, key) {
  const row = getDb()
    .prepare("SELECT value_json, updated_at FROM app_data WHERE app_id = ? AND key = ?")
    .get(appId, key);
  if (!row) return null;
  return {
    key,
    value: JSON.parse(row.value_json),
    updatedAt: row.updated_at,
  };
}

export function setAppData(appId, key, value) {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO app_data (app_id, key, value_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(app_id, key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    )
    .run(appId, key, JSON.stringify(value), now);
  return { key, value, updatedAt: now };
}

export function deleteAppData(appId, key) {
  const result = getDb()
    .prepare("DELETE FROM app_data WHERE app_id = ? AND key = ?")
    .run(appId, key);
  return result.changes > 0;
}

export function listAppDataKeys(appId) {
  return getDb()
    .prepare("SELECT key, updated_at FROM app_data WHERE app_id = ? ORDER BY key")
    .all(appId)
    .map((row) => ({ key: row.key, updatedAt: row.updated_at }));
}

export function createAppJob({
  appId,
  name,
  schedule,
  handler,
  payload = null,
  enabled = true,
  nextRunAt = null,
}) {
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO app_jobs (
        id, app_id, name, schedule, handler, payload_json,
        enabled, last_run_at, next_run_at, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
    )
    .run(
      id,
      appId,
      name,
      schedule,
      handler,
      payload != null ? JSON.stringify(payload) : null,
      enabled ? 1 : 0,
      nextRunAt ?? now,
    );
  return getAppJob(appId, id);
}

export function getAppJob(appId, jobId) {
  const row = getDb()
    .prepare("SELECT * FROM app_jobs WHERE app_id = ? AND id = ?")
    .get(appId, jobId);
  return row ? rowToJob(row) : null;
}

export function listAppJobs(appId) {
  return getDb()
    .prepare("SELECT * FROM app_jobs WHERE app_id = ? ORDER BY name")
    .all(appId)
    .map(rowToJob);
}

export function updateAppJob(appId, jobId, patch) {
  const fields = [];
  const values = [];
  const allowed = {
    name: "name",
    schedule: "schedule",
    handler: "handler",
    payload_json: "payloadJson",
    enabled: "enabled",
    last_run_at: "lastRunAt",
    next_run_at: "nextRunAt",
    last_error: "lastError",
  };

  for (const [col, key] of Object.entries(allowed)) {
    if (patch[key] !== undefined) {
      fields.push(`${col} = ?`);
      let val = patch[key];
      if (key === "payloadJson" && val != null) val = JSON.stringify(val);
      if (key === "enabled") val = val ? 1 : 0;
      values.push(val);
    }
  }
  if (!fields.length) return getAppJob(appId, jobId);
  values.push(appId, jobId);
  getDb()
    .prepare(`UPDATE app_jobs SET ${fields.join(", ")} WHERE app_id = ? AND id = ?`)
    .run(...values);
  return getAppJob(appId, jobId);
}

export function deleteAppJob(appId, jobId) {
  const result = getDb()
    .prepare("DELETE FROM app_jobs WHERE app_id = ? AND id = ?")
    .run(appId, jobId);
  return result.changes > 0;
}

export function listDueJobs(now = Date.now()) {
  return getDb()
    .prepare(
      `SELECT * FROM app_jobs
       WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
       ORDER BY next_run_at ASC`,
    )
    .all(now)
    .map(rowToJob);
}

function rowToJob(row) {
  return {
    id: row.id,
    appId: row.app_id,
    name: row.name,
    schedule: row.schedule,
    handler: row.handler,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastError: row.last_error,
  };
}
