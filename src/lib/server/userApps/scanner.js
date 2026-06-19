import fs from "node:fs/promises";
import path from "node:path";
import {
  MANIFEST_FILENAME,
  publishedAppDir,
  publishedAppsRoot,
  workspaceAppDir,
  workspaceAppsRoot,
} from "./paths.js";
import { manifestToRegistryFields, readManifestFromDir } from "./manifest.js";
import { upsertUserApp, getUserAppBySlug } from "./repository.js";

async function publishedPackageExists(slug) {
  try {
    await fs.access(path.join(publishedAppDir(slug), MANIFEST_FILENAME));
    return true;
  } catch {
    return false;
  }
}

async function dirHasManifest(dir) {
  try {
    await fs.access(path.join(dir, MANIFEST_FILENAME));
    return true;
  } catch {
    return false;
  }
}

async function listAppDirs(root) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const dirs = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
      const full = path.join(root, entry.name);
      if (await dirHasManifest(full)) dirs.push(entry.name);
    }
    return dirs;
  } catch {
    return [];
  }
}

export async function scanWorkspaceApps() {
  await fs.mkdir(workspaceAppsRoot(), { recursive: true });
  const slugs = await listAppDirs(workspaceAppsRoot());
  const apps = [];
  for (const slug of slugs) {
    try {
      const manifest = await readManifestFromDir(workspaceAppDir(slug));
      const fields = manifestToRegistryFields(manifest);
      const existing = getUserAppBySlug(slug);
      const isPublished = await publishedPackageExists(slug);
      const app = upsertUserApp({
        ...fields,
        status: isPublished ? "published" : "draft",
        source: isPublished ? "published" : "workspace",
        publishedAt: isPublished ? (existing?.publishedAt ?? Date.now()) : null,
      });
      apps.push(app);
    } catch (error) {
      console.warn(`[userApps] Skipping workspace app ${slug}:`, error.message);
    }
  }
  return apps;
}

export async function scanPublishedApps() {
  await fs.mkdir(publishedAppsRoot(), { recursive: true });
  const slugs = await listAppDirs(publishedAppsRoot());
  const apps = [];
  for (const slug of slugs) {
    try {
      const manifest = await readManifestFromDir(publishedAppDir(slug));
      const fields = manifestToRegistryFields(manifest);
      const app = upsertUserApp({
        ...fields,
        status: "published",
        source: "published",
        publishedAt: Date.now(),
      });
      apps.push(app);
    } catch (error) {
      console.warn(`[userApps] Skipping published app ${slug}:`, error.message);
    }
  }
  return apps;
}

export async function syncAllUserApps() {
  const workspace = await scanWorkspaceApps();
  const published = await scanPublishedApps();
  return { workspace, published };
}

export async function scanAppSlug(slug, { source = "workspace" } = {}) {
  const appDir = source === "published" ? publishedAppDir(slug) : workspaceAppDir(slug);
  const manifest = await readManifestFromDir(appDir);
  const fields = manifestToRegistryFields(manifest);
  return upsertUserApp({
    ...fields,
    status: source === "published" ? "published" : "draft",
    source,
    publishedAt: source === "published" ? Date.now() : null,
  });
}
