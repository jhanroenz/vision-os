import fs from "node:fs/promises";
import path from "node:path";
import { detectProjectRoot, fileExists } from "../codebase/context.js";
import { resolveSafePath } from "../workspace.js";
import { getWrittenFiles } from "../actionTracker.js";
import { checkSyntaxWithTreeSitter } from "./treeSitter.js";

const SOURCE_EXT = /\.(html?|css|m?js|cjs)$/i;
const MAX_FILES = 25;
const MAX_DEPTH = 2;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".jarvis",
  "dist",
  "build",
  ".next",
]);

/**
 * @param {string} projectRoot workspace-relative folder
 */
async function collectBareSourceFiles(projectRoot, maxFiles = MAX_FILES) {
  const absRoot = resolveSafePath(projectRoot);
  const files = [];

  async function walk(dir, depth) {
    if (depth > MAX_DEPTH || files.length >= maxFiles) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP_DIRS.has(entry.name)) continue;

      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }

      if (!SOURCE_EXT.test(entry.name)) continue;

      const rel = path
        .relative(absRoot, full)
        .replace(/\\/g, "/");
      files.push(rel);
      if (files.length >= maxFiles) return;
    }
  }

  await walk(absRoot, 0);
  return files;
}

/**
 * Plain HTML/JS/CSS or vanilla JS without package.json / Cargo.toml / etc.
 * @param {string} relativePath
 */
export async function detectBareProject(relativePath) {
  const normalized =
    String(relativePath ?? ".")
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .replace(/^\.\//, "") || ".";

  const manifest = await detectProjectRoot(normalized);
  if (manifest.projectRoot) return null;

  const absPath = resolveSafePath(normalized);
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }

  const sourceFiles = await collectBareSourceFiles(normalized);
  if (!sourceFiles.length) return null;

  const hasHtml = sourceFiles.some((f) => /\.html?$/i.test(f));
  const hasJs = sourceFiles.some((f) => /\.m?js$/i.test(f));
  const hasCss = sourceFiles.some((f) => /\.css$/i.test(f));

  let stack = null;
  if (hasHtml) stack = "static-web";
  else if (hasJs) stack = "vanilla-js";
  else if (hasCss) stack = "static-web";

  if (!stack) return null;

  return { projectRoot: normalized, stack, sourceFiles };
}

function filesUnderProject(projectRoot, filePaths) {
  const prefix = projectRoot === "." ? "" : `${projectRoot}/`;
  return filePaths.filter((f) => {
    const n = f.replace(/\\/g, "/");
    return n === projectRoot || n.startsWith(prefix);
  });
}

/**
 * Syntax-only verification for bare projects.
 * @param {string} projectRoot
 * @param {{ threadId?: string | null }} opts
 */
export async function verifyBareProject(projectRoot, { threadId = null } = {}) {
  const bare = await detectBareProject(projectRoot);
  if (!bare) return null;

  let files = bare.sourceFiles;

  if (threadId) {
    const written = filesUnderProject(bare.projectRoot, getWrittenFiles(threadId))
      .filter((f) => SOURCE_EXT.test(f));
    if (written.length) {
      files = [
        ...new Set(
          written.map((f) =>
            f.startsWith(`${bare.projectRoot}/`)
              ? f.slice(bare.projectRoot.length + 1)
              : f,
          ),
        ),
      ];
    }
  }

  const lines = [
    `Bare project: ${bare.projectRoot} (${bare.stack})`,
    "No manifest file — running check_syntax on HTML/JS/CSS only.",
    "",
  ];

  let allPassed = true;
  let checked = 0;

  for (const rel of files) {
    if (checked >= MAX_FILES) break;
    const filePath =
      bare.projectRoot === "."
        ? rel
        : `${bare.projectRoot}/${rel}`.replace(/\/+/g, "/");
    const abs = resolveSafePath(filePath);

    if (!(await fileExists(abs))) continue;

    let content;
    try {
      content = await fs.readFile(abs, "utf-8");
    } catch {
      continue;
    }

    checked++;
    const { errors } = await checkSyntaxWithTreeSitter(filePath, content);

    if (!errors.length) {
      lines.push(`  [PASS] ${filePath}`);
      continue;
    }

    allPassed = false;
    lines.push(`  [FAIL] ${filePath} (${errors.length} issue(s))`);
    for (const err of errors.slice(0, 5)) {
      const col = err.column ? `:${err.column}` : "";
      lines.push(`    line ${err.line}${col}: ${err.message}`);
    }
  }

  if (checked === 0) {
    return {
      passed: false,
      output: [
        ...lines,
        "No readable HTML/JS/CSS files found to check.",
        "OVERALL: FAIL — add sources or call check_syntax on each file.",
      ].join("\n"),
    };
  }

  lines.push("");
  lines.push(
    allPassed
      ? "OVERALL: PASS — bare project syntax checks passed."
      : "OVERALL: FAIL — fix syntax/markup errors above, then verify again.",
  );

  return { passed: allPassed, output: lines.join("\n") };
}
