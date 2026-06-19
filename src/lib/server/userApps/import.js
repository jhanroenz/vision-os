import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafePath } from "../workspace.js";
import { workspaceAppDir, MANIFEST_FILENAME } from "./paths.js";
import { manifestSchema, readManifestFromDir, writeManifest } from "./manifest.js";
import { publishUserApp } from "./publish.js";
import { scanAppSlug } from "./scanner.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "apps",
  ".jarvis",
  "dist",
  "build",
  ".svelte-kit",
]);

const SKIP_FILES = new Set([
  "package.json",
  "package-lock.json",
  "vite.config.js",
  "webspatial.json",
  "manifest.webmanifest",
  ".gitignore",
  "README.md",
]);

const WEB_ASSET_EXT = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
]);

function fallbackNameFromSlug(slug) {
  return String(slug ?? "my-app")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function copyWebAssets(srcDir, destDir, rel = "") {
  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === MANIFEST_FILENAME) continue;
    const from = path.join(srcDir, entry.name);
    const nextRel = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await copyWebAssets(from, path.join(destDir, entry.name), nextRel);
      continue;
    }
    if (SKIP_FILES.has(entry.name)) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!WEB_ASSET_EXT.has(ext)) continue;
    await fs.copyFile(from, path.join(destDir, entry.name));
  }
}

/**
 * Import an existing workspace folder as a VisionOS user app package.
 * @param {{ id: string, name?: string, sourcePath?: string, icon?: string, publish?: boolean }} opts
 */
export async function importWorkspaceAsUserApp({
  id,
  name,
  sourcePath = ".",
  icon = "🎮",
  publish = true,
}) {
  const slug = String(id).trim();
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error("Invalid id — use lowercase slug [a-z0-9-]+");
  }

  const srcDir = resolveSafePath(sourcePath);
  const destDir = workspaceAppDir(slug);

  try {
    await fs.access(path.join(srcDir, "index.html"));
  } catch {
    throw new Error(`Source ${sourcePath} has no index.html — cannot import as sandbox app`);
  }

  await fs.rm(destDir, { recursive: true, force: true });
  await copyWebAssets(srcDir, destDir);

  let manifest;
  try {
    const fromSource = await readManifestFromDir(srcDir);
    manifest = manifestSchema.parse({
      ...fromSource,
      id: slug,
      name: name ?? fromSource.name,
    });
  } catch {
    manifest = manifestSchema.parse({
      id: slug,
      name: name ?? fallbackNameFromSlug(slug),
      icon,
      type: "sandbox",
      entry: "index.html",
      defaultWidth: 520,
      defaultHeight: 640,
      launcher: true,
      permissions: ["storage"],
    });
  }
  await writeManifest(destDir, manifest);

  const draft = await scanAppSlug(slug, { source: "workspace" });
  if (!publish) return { draft, published: null };

  const published = await publishUserApp(slug);
  return { draft, published, registryId: published.id };
}
