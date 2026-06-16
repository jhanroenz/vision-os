import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import {
  resolveSafePath,
  getLockedProjectRoot,
  getActiveProjectRoot,
  getThreadCwd,
} from "./workspace.js";

const IGNORE_DIR_NAMES = new Set([
  ".cursor",
  ".git",
  ".jarvis",
  ".next",
  ".nuxt",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "Stash",
  "target",
  "vendor",
]);

const SKIP_FILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
]);

const SKIP_EXTENSIONS = new Set([
  ".bin",
  ".dll",
  ".exe",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".map",
  ".mp3",
  ".mp4",
  ".o",
  ".pdf",
  ".png",
  ".so",
  ".svg",
  ".wasm",
  ".webm",
  ".woff",
  ".woff2",
  ".zip",
]);

/**
 * @typedef {{
 *   scanRoot: string,
 *   paths: string[],
 *   fileCount: number,
 *   dirCount: number,
 *   truncated: boolean,
 *   omitted: number,
 *   scannedAt: number,
 * }} WorkspaceFileMap
 */

export function resolveFileMapScanRoot(threadId) {
  const locked = getLockedProjectRoot(threadId);
  if (locked && locked !== ".") return normalizeScanRoot(locked);

  const active = getActiveProjectRoot(threadId);
  if (active && active !== ".") return normalizeScanRoot(active);

  const cwd = getThreadCwd(threadId);
  if (cwd && cwd !== ".") return normalizeScanRoot(cwd);

  return ".";
}

function normalizeScanRoot(root) {
  return String(root ?? ".")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "") || ".";
}

function shouldSkipDir(name) {
  return IGNORE_DIR_NAMES.has(name) || name.startsWith(".");
}

function shouldSkipFile(name) {
  if (SKIP_FILE_NAMES.has(name)) return true;
  if (name.startsWith(".")) return true;
  const ext = path.extname(name).toLowerCase();
  return SKIP_EXTENSIONS.has(ext);
}

function formatFilePath(scanRoot, relativePath) {
  const rel = relativePath.replace(/\\/g, "/");
  if (scanRoot === ".") return `./${rel}`;
  return `./${scanRoot}/${rel}`;
}

/**
 * Walk workspace tree and collect file paths (compact, LLM-oriented).
 * @param {string} scanRoot — workspace-relative directory
 * @param {{ maxDepth?: number, maxFiles?: number }} [options]
 * @returns {Promise<WorkspaceFileMap>}
 */
export async function buildWorkspaceFileMap(scanRoot = ".", options = {}) {
  const root = normalizeScanRoot(scanRoot);
  const maxDepth = options.maxDepth ?? config.workspaceFileMap.maxDepth;
  const maxFiles = options.maxFiles ?? config.workspaceFileMap.maxFiles;

  const absRoot = resolveSafePath(root);
  const paths = [];
  const seenDirs = new Set();
  let truncated = false;

  async function walk(absDir, relDir, depth) {
    if (truncated || depth > maxDepth) return;

    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (truncated) break;

      const rel =
        relDir === "." ? entry.name : `${relDir}/${entry.name}`.replace(/\/+/g, "/");
      const abs = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        seenDirs.add(rel);
        await walk(abs, rel, depth + 1);
        continue;
      }

      if (!entry.isFile() || shouldSkipFile(entry.name)) continue;

      paths.push(formatFilePath(root, rel));
      if (paths.length >= maxFiles) truncated = true;
    }
  }

  try {
    const stat = await fs.stat(absRoot);
    if (!stat.isDirectory()) {
      return {
        scanRoot: root,
        paths: [formatFilePath(root, path.basename(root))],
        fileCount: 1,
        dirCount: 0,
        truncated: false,
        omitted: 0,
        scannedAt: Date.now(),
      };
    }
  } catch {
    return {
      scanRoot: root,
      paths: [],
      fileCount: 0,
      dirCount: 0,
      truncated: false,
      omitted: 0,
      scannedAt: Date.now(),
    };
  }

  await walk(absRoot, ".", 0);

  return {
    scanRoot: root,
    paths,
    fileCount: paths.length,
    dirCount: seenDirs.size,
    truncated,
    omitted: truncated ? Math.max(0, paths.length - maxFiles + 1) : 0,
    scannedAt: Date.now(),
  };
}

export function formatWorkspaceFileMapLines(map, { maxChars } = {}) {
  const limit = maxChars ?? config.workspaceFileMap.maxChars;
  const header = [
    "[Workspace file map — authoritative paths for read_file / read_files / write_file]",
    `Scan root: ${map.scanRoot === "." ? "workspace" : map.scanRoot} · ${map.fileCount} file(s) in ${map.dirCount} folder(s)`,
    "Copy paths exactly — do not invent locations.",
  ];

  const body = [];
  let chars = header.join("\n").length + 2;

  for (const p of map.paths) {
    if (chars + p.length + 1 > limit) {
      body.push(
        `… +${map.paths.length - body.length} more path(s) — use glob_files or list_directory`,
      );
      break;
    }
    body.push(p);
    chars += p.length + 1;
  }

  if (map.truncated && !body.some((l) => l.startsWith("…"))) {
    body.push(
      `… capped at ${config.workspaceFileMap.maxFiles} files — use glob_files for specific patterns`,
    );
  }

  return [...header, "", ...body].join("\n");
}

export function formatWorkspaceFileMapBrief(map) {
  return formatWorkspaceFileMapLines(map);
}

/**
 * @param {string} threadId
 * @param {{ root?: string, force?: boolean }} [options]
 */
export async function ensureWorkspaceFileMap(threadId, options = {}) {
  const { getWorkspaceFileMap, recordWorkspaceFileMap } = await import("./fileContext.js");

  const scanRoot = normalizeScanRoot(options.root ?? resolveFileMapScanRoot(threadId));
  const existing = getWorkspaceFileMap(threadId);

  if (existing && !options.force && existing.scanRoot === scanRoot) {
    return existing;
  }

  const map = await buildWorkspaceFileMap(scanRoot);
  recordWorkspaceFileMap(threadId, map);
  return map;
}
