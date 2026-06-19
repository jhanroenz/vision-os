import fs from "node:fs/promises";
import path from "node:path";
import {
  publishedAppDir,
  publishedAppsRoot,
  workspaceAppDir,
} from "./paths.js";
import {
  readManifestFromDir,
  validateManifestForPublish,
  manifestToRegistryFields,
} from "./manifest.js";
import { upsertUserApp } from "./repository.js";
import { scanAppSlug } from "./scanner.js";

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

export async function publishUserApp(slug) {
  const srcDir = workspaceAppDir(slug);
  const destDir = publishedAppDir(slug);

  let manifest;
  try {
    manifest = await readManifestFromDir(srcDir);
  } catch (error) {
    throw new Error(`Cannot read manifest for ${slug}: ${error.message}`);
  }

  if (manifest.id !== slug) {
    throw new Error(`Manifest id "${manifest.id}" must match folder slug "${slug}"`);
  }

  const errors = await validateManifestForPublish(manifest, srcDir);
  if (errors.length) {
    throw new Error(`Publish validation failed: ${errors.join("; ")}`);
  }

  await fs.mkdir(publishedAppsRoot(), { recursive: true });
  await fs.rm(destDir, { recursive: true, force: true });
  await copyDir(srcDir, destDir);

  const fields = manifestToRegistryFields(manifest);
  const now = Date.now();
  const app = upsertUserApp({
    ...fields,
    status: "published",
    source: "published",
    publishedAt: now,
  });

  return app;
}

export async function unpublishUserApp(slug) {
  const destDir = publishedAppDir(slug);
  await fs.rm(destDir, { recursive: true, force: true });
  await scanAppSlug(slug, { source: "workspace" }).catch(() => null);
  const { getUserAppBySlug } = await import("./repository.js");
  const existing = getUserAppBySlug(slug);
  if (existing?.status === "published") {
    const fields = manifestToRegistryFields(existing.manifest);
    return upsertUserApp({
      ...fields,
      status: "draft",
      source: "workspace",
      publishedAt: null,
    });
  }
  return existing;
}

/** Remove published copy, workspace source, and all DB records for an app. */
export async function uninstallUserApp(slug) {
  await fs.rm(publishedAppDir(slug), { recursive: true, force: true });
  await fs.rm(workspaceAppDir(slug), { recursive: true, force: true });
  const { deleteUserApp } = await import("./repository.js");
  deleteUserApp(slug);
  return { ok: true, slug };
}
