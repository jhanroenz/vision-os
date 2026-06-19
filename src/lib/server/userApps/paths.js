import path from "node:path";
import { config } from "../config.js";
import { resolveDataDir, resolveVisionRoot } from "../paths.js";

export const MANIFEST_FILENAME = "visionos.app.json";

/** Registry id for a user app slug. */
export function registryIdFromSlug(slug) {
  return `user:${slug}`;
}

/** Extract slug from registry id, or null if not a user app id. */
export function slugFromRegistryId(id) {
  const raw = String(id ?? "");
  if (raw.startsWith("user:")) return raw.slice(5);
  return null;
}

/** Normalize route/handler app id to slug. */
export function normalizeAppSlug(appId) {
  const slug = slugFromRegistryId(appId);
  if (slug) return slug;
  const raw = String(appId ?? "").trim();
  if (/^[a-z0-9-]+$/.test(raw)) return raw;
  throw new Error(`Invalid app id: ${appId}`);
}

export function workspaceAppsRoot() {
  return path.join(config.workspaceDir, "apps");
}

export function publishedAppsRoot() {
  return path.join(resolveDataDir(), "apps");
}

export function workspaceAppDir(slug) {
  return path.join(workspaceAppsRoot(), slug);
}

export function publishedAppDir(slug) {
  return path.join(publishedAppsRoot(), slug);
}

export function repoTemplateRoot() {
  if (process.env.VISIONOS_TEMPLATE_ROOT) {
    return path.resolve(process.env.VISIONOS_TEMPLATE_ROOT);
  }
  return path.join(resolveVisionRoot(), "apps", "_template");
}
