import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRetriv } from "retriv";
import { autoChunker } from "retriv/chunkers/auto";
import sqlite from "retriv/db/sqlite";
import { transformersJs } from "retriv/embeddings/transformers-js";
import { config } from "../config.js";
import { resolveSafePath } from "../workspace.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".vite",
  ".nuxt",
  ".next",
  ".jarvis",
  "__pycache__",
  ".pytest_cache",
  "target",
  "vendor",
  ".cache",
]);

const SKIP_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
]);

const INDEXABLE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".vue",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".md",
  ".css",
  ".scss",
  ".html",
  ".yaml",
  ".yml",
  ".toml",
  ".json",
  ".sql",
  ".sh",
]);

let searchInstance = null;
let initPromise = null;

function indexDir() {
  return path.join(config.workspaceDir, ".jarvis");
}

function dbPath() {
  return path.join(indexDir(), "semantic-index.db");
}

function manifestPath() {
  return path.join(indexDir(), "semantic-manifest.json");
}

function workspaceRel(absPath) {
  const workspace = resolveSafePath(".");
  return path.relative(workspace, absPath).replace(/\\/g, "/") || ".";
}

function shouldSkipFile(name, size) {
  if (SKIP_FILES.has(name)) return true;
  if (name.endsWith(".min.js") || name.endsWith(".map")) return true;
  if (size > config.semanticSearch.maxFileSize) return true;
  return !INDEXABLE_EXT.has(path.extname(name).toLowerCase());
}

async function loadManifest() {
  try {
    const raw = await fs.readFile(manifestPath(), "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.files ?? {};
  } catch {
    return {};
  }
}

async function saveManifest(files) {
  await fs.mkdir(indexDir(), { recursive: true });
  await fs.writeFile(
    manifestPath(),
    `${JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        model: config.semanticSearch.model,
        files,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

async function getSearch() {
  if (!config.semanticSearch.enabled) {
    throw new Error("Semantic search is disabled (SEMANTIC_SEARCH_ENABLED=false)");
  }
  if (searchInstance) return searchInstance;
  if (!initPromise) {
    initPromise = (async () => {
      await fs.mkdir(indexDir(), { recursive: true });
      searchInstance = await createRetriv({
        driver: sqlite({
          path: dbPath(),
          embeddings: transformersJs({
            model: config.semanticSearch.model,
          }),
        }),
        chunking: autoChunker(),
        categories: (doc) => doc.metadata?.type ?? "other",
      });
      return searchInstance;
    })();
  }
  return initPromise;
}

async function walkProject(rootAbs, rootRel, files, stats) {
  if (files.length >= config.semanticSearch.maxFilesPerIndex) return;

  let entries;
  try {
    entries = await fs.readdir(rootAbs, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (files.length >= config.semanticSearch.maxFilesPerIndex) break;
    if (SKIP_DIRS.has(entry.name)) continue;

    const rel =
      rootRel === "." ? entry.name : `${rootRel}/${entry.name}`.replace(/\\/g, "/");
    const full = path.join(rootAbs, entry.name);

    if (entry.isDirectory()) {
      await walkProject(full, rel, files, stats);
      continue;
    }

    if (!entry.isFile()) continue;

    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }

    if (shouldSkipFile(entry.name, stat.size)) {
      stats.skipped += 1;
      continue;
    }

    files.push({ rel, abs: full, mtimeMs: stat.mtimeMs, size: stat.size });
  }
}

async function hashFile(absPath) {
  const buf = await fs.readFile(absPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function docTypeForPath(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  if ([".md"].includes(ext)) return "docs";
  if ([".json", ".yaml", ".yml", ".toml"].includes(ext)) return "config";
  return "code";
}

async function readFileText(absPath) {
  const buf = await fs.readFile(absPath);
  if (buf.includes(0)) return null;
  return buf.toString("utf-8");
}

export async function ensureProjectIndexed(searchPath = ".", { force = false } = {}) {
  if (!config.semanticSearch.enabled) {
    return { indexed: 0, removed: 0, skipped: 0, unchanged: 0, disabled: true };
  }

  const rootAbs = resolveSafePath(searchPath);
  const rootRel = workspaceRel(rootAbs);
  const search = await getSearch();
  const manifest = await loadManifest();
  const stats = { indexed: 0, removed: 0, skipped: 0, unchanged: 0 };

  const discovered = [];
  await walkProject(rootAbs, rootRel, discovered, stats);

  const discoveredSet = new Set(discovered.map((f) => f.rel));
  const toRemove = [];

  for (const rel of Object.keys(manifest)) {
    const inScope = rel === rootRel || rel.startsWith(`${rootRel}/`);
    if (inScope && !discoveredSet.has(rel)) {
      toRemove.push(rel);
      delete manifest[rel];
    }
  }

  if (toRemove.length && search.remove) {
    await search.remove(toRemove);
    stats.removed = toRemove.length;
  }

  const batch = [];

  for (const file of discovered) {
    let hash = manifest[file.rel]?.hash;
    if (!force && hash) {
      try {
        hash = await hashFile(file.abs);
        if (manifest[file.rel].hash === hash && manifest[file.rel].mtimeMs === file.mtimeMs) {
          stats.unchanged += 1;
          continue;
        }
      } catch {
        stats.skipped += 1;
        continue;
      }
    } else {
      try {
        hash = await hashFile(file.abs);
      } catch {
        stats.skipped += 1;
        continue;
      }
    }

    if (!force && manifest[file.rel]?.hash === hash) {
      stats.unchanged += 1;
      continue;
    }

    const content = await readFileText(file.abs);
    if (content == null) {
      stats.skipped += 1;
      continue;
    }

    if (manifest[file.rel] && search.remove) {
      await search.remove([file.rel]);
    }

    batch.push({
      id: file.rel,
      content,
      metadata: {
        type: docTypeForPath(file.rel),
        path: file.rel,
        ext: path.extname(file.rel).toLowerCase(),
      },
    });

    manifest[file.rel] = { hash, mtimeMs: file.mtimeMs, size: file.size };

    if (batch.length >= 25) {
      const chunk = batch.splice(0, 25);
      await search.index(chunk);
      stats.indexed += chunk.length;
    }
  }

  if (batch.length) {
    await search.index(batch);
    stats.indexed += batch.length;
  }

  await saveManifest(manifest);
  return stats;
}

function formatEntity(entity) {
  if (!entity) return "";
  if (entity.signature) return entity.signature;
  return `${entity.type} ${entity.name}`;
}

export function formatSemanticResults(results, query, scopeRel) {
  if (!results.length) {
    return `No semantic matches for "${query}" under ${scopeRel}`;
  }

  const lines = [
    `=== SEMANTIC SEARCH: "${query}" in ${scopeRel} ===`,
    `Matches: ${results.length} (hybrid BM25 + vector via retriv)`,
    "",
  ];

  for (const [i, result] of results.entries()) {
    const chunk = result._chunk;
    const filePath = chunk?.parentId ?? result.metadata?.path ?? result.id.split("#")[0];
    const lineRange = chunk?.lineRange;
    const loc = lineRange ? `${filePath}:${lineRange[0]}-${lineRange[1]}` : filePath;
    const score = typeof result.score === "number" ? result.score.toFixed(3) : "?";
    const entity = chunk?.entities?.[0];
    const scope = chunk?.scope?.map((s) => s.name).filter(Boolean).join(".");

    lines.push(`${i + 1}. [${score}] ${loc}`);
    if (entity) lines.push(`   ${formatEntity(entity)}`);
    if (scope) lines.push(`   in ${scope}`);

    const snippet = (result.content ?? "")
      .split("\n")
      .slice(0, 6)
      .map((l) => `   ${l}`)
      .join("\n");
    if (snippet) lines.push(snippet);
    lines.push("");
  }

  return lines.join("\n").trim();
}

export async function runSemanticSearch(
  query,
  { path: searchPath = ".", limit, forceReindex = false } = {},
) {
  if (!config.semanticSearch.enabled) {
    return (
      "Semantic search is disabled. Use grep_code for exact text/symbol search " +
      "or glob_files to locate files by pattern."
    );
  }

  if (!query?.trim()) {
    return "Error: query is required";
  }

  const rootAbs = resolveSafePath(searchPath);
  const scopeRel = workspaceRel(rootAbs);

  const indexStats = await ensureProjectIndexed(scopeRel, { force: forceReindex });

  const search = await getSearch();
  const maxResults = Math.min(
    Math.max(limit ?? config.semanticSearch.maxResults, 1),
    20,
  );

  const filter =
    scopeRel && scopeRel !== "."
      ? { path: { $prefix: `${scopeRel}/` } }
      : undefined;

  const results = await search.search(query.trim(), {
    limit: maxResults,
    returnContent: true,
    returnMetadata: true,
    filter,
  });

  const header =
    indexStats.indexed || indexStats.removed
      ? `Indexed ${indexStats.indexed} file(s), removed ${indexStats.removed} stale.\n\n`
      : "";

  return header + formatSemanticResults(results, query.trim(), scopeRel);
}

export async function closeSemanticIndex() {
  if (searchInstance?.close) {
    await searchInstance.close();
  }
  searchInstance = null;
  initPromise = null;
}
