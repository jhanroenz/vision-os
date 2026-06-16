import fs from "node:fs/promises";
import {
  resolveSafePath,
  extractProjectPathFromMessage,
  isNewScaffoldTask,
} from "./workspace.js";
import { isSuccessfulToolResult } from "./verification.js";
import { EXPLICIT_TOOL_WORK } from "./codingResearch.js";
import {
  extractDeletePathsFromMessage,
  buildFilesystemActions,
  buildFilesystemActionPlanBlock,
  FILESYSTEM_AWARENESS_RULES,
  pathExplicitlyReferenced,
} from "./filesystemAwareness.js";
import { describeCodebase, fileExists } from "./codebase/context.js";
import { GREENFIELD_BRIEF_LINES } from "./scaffoldGuidance.js";
const turnAwareness = new Map();

const GREENFIELD_SCAFFOLD_FILES = [
  "index.html",
  "style.css",
  "main.js",
  "src/index.js",
];

const AWARENESS_PROBE_TOOLS = new Set([
  "list_directory",
  "inspect_codebase",
  "detect_stack",
  "search_files",
]);

async function appendGreenfieldPreflightEntries(entries, scanRoot) {
  const root = scanRoot && scanRoot !== "." ? String(scanRoot).replace(/\/+$/, "") : ".";

  if (!entries.some((e) => e.path === root)) {
    const rootRow = await pathEntry(root);
    entries.push({ path: root, exists: rootRow.exists, kind: rootRow.kind ?? "dir" });
  }

  for (const file of GREENFIELD_SCAFFOLD_FILES) {
    const rel = root === "." ? file : `${root}/${file}`;
    if (entries.some((e) => e.path === rel)) continue;
    const row = await pathEntry(rel);
    entries.push({ path: rel, exists: row.exists, kind: row.kind });
  }
}

/** Exact tool runbook — skip research/plan ceremony, run tools directly. */
export function isExplicitToolRunbook(message) {
  const text = String(message ?? "");
  return (
    EXPLICIT_TOOL_WORK.test(text) &&
    /\buse tools only\b/i.test(text) &&
    (/\brun_bash\b/i.test(text) || /\bmkdir\b/i.test(text)) &&
    /\bwrite_file\b/i.test(text)
  );
}

/** Probe only the detected stack's manifest, entry files, and src/ — not every language. */
async function collectProjectProbePaths(projectRoot) {
  const paths = new Set();
  if (!projectRoot || projectRoot === ".") return paths;

  const root = String(projectRoot).replace(/\\/g, "/").replace(/\/+$/, "");
  paths.add(root);

  const info = await describeCodebase(root);
  const detectedRoot = info.projectRoot ?? root;

  if (info.scaffold) {
    const readme = `${detectedRoot}/README.md`;
    if (await fileExists(readme)) paths.add(readme);
    return paths;
  }

  if (info.projectRoot && info.marker) {
    paths.add(`${info.projectRoot}/${info.marker}`);
  }

  for (const hint of info.entryHints ?? []) {
    const rel = String(hint).replace(/^\.\//, "");
    paths.add(`${detectedRoot}/${rel}`);
  }

  const srcDir = `${detectedRoot}/src`;
  if (await fileExists(srcDir)) {
    paths.add(srcDir);
  }

  return paths;
}

/** Paths the user explicitly asked to create, read, or write. */
export function extractTargetPathsFromMessage(message) {
  const paths = new Set();
  const text = String(message ?? "");

  for (const m of text.matchAll(
    /\b(?:write_file|read_file|search_replace)\s+([a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*)/gi,
  )) {
    paths.add(m[1].replace(/\\/g, "/"));
  }

  for (const m of text.matchAll(
    /\bmkdir\s+(?:-p\s+)?([a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*)/gi,
  )) {
    paths.add(m[1].replace(/\\/g, "/"));
  }

  for (const p of extractDeletePathsFromMessage(text)) {
    paths.add(p);
  }

  for (const m of text.matchAll(
    /\b([a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)+)\b/g,
  )) {
    const candidate = m[1].replace(/\\/g, "/");
    if (pathExplicitlyReferenced(text, candidate)) {
      paths.add(candidate);
    }
  }

  const project = extractProjectPathFromMessage(message);
  if (project) {
    paths.add(project.split("/")[0]);
  }

  return [...paths];
}

export async function collectAwarenessTargets(message, context = {}) {
  const paths = new Set(extractTargetPathsFromMessage(message));
  const roots = new Set();

  for (const r of [
    context.lockedProjectRoot,
    context.activeProjectRoot,
    ...(context.mentionedProjects ?? []),
  ]) {
    if (r && r !== ".") roots.add(String(r).split("/")[0]);
  }

  const project = extractProjectPathFromMessage(message);
  if (project && pathExplicitlyReferenced(message, project)) {
    roots.add(project.split("/")[0]);
  }

  for (const root of roots) {
    for (const p of await collectProjectProbePaths(root)) {
      paths.add(p);
    }
  }

  return [...paths];
}

async function discoverLayoutNotes(projectRoot, message) {
  if (!projectRoot) return [];
  const notes = [];
  const expectedSrcIndex = `${projectRoot}/src/index.js`;
  const flatIndex = `${projectRoot}/index.js`;

  try {
    const flatExists = await pathEntry(flatIndex);
    const srcIndexRow = extractTargetPathsFromMessage(message).includes(expectedSrcIndex);
    if (flatExists.exists && srcIndexRow) {
      const srcIndexExists = await pathEntry(expectedSrcIndex);
      if (!srcIndexExists.exists) {
        notes.push(
          `STRUCTURE: ${flatIndex} EXISTS but ${expectedSrcIndex} is MISSING — move or read ${flatIndex} before creating src/.`,
        );
      }
    }
  } catch {
    // ignore scan errors
  }
  return notes;
}

async function pathEntry(relativePath) {
  try {
    const stat = await fs.stat(resolveSafePath(relativePath));
    return { exists: true, kind: stat.isDirectory() ? "dir" : "file" };
  } catch {
    return { exists: false, kind: null };
  }
}

/**
 * Scan disk for paths referenced in the message and active project roots
 * before planning or executing.
 */
export async function runWorkspacePreflight(message, context = {}) {
  const scanContext = { ...context, message };
  const targets = await collectAwarenessTargets(message, scanContext);
  const projectRoot =
    extractProjectPathFromMessage(message)?.split("/")[0] ??
    (context.lockedProjectRoot && context.lockedProjectRoot !== "."
      ? String(context.lockedProjectRoot).split("/")[0]
      : null) ??
    (context.activeProjectRoot && context.activeProjectRoot !== "."
      ? String(context.activeProjectRoot).split("/")[0]
      : null);

  const entries = [];
  for (const p of targets) {
    const { exists, kind } = await pathEntry(p);
    entries.push({ path: p, exists, kind });
  }

  const rootEntry = projectRoot
    ? entries.find((e) => e.path === projectRoot)
    : null;
  const packageJson = entries.find((e) => e.path.endsWith("package.json"));
  const indexJs = entries.find((e) => /\/index\.js$/i.test(e.path));

  const scaffoldPresent = Boolean(
    rootEntry?.exists &&
      packageJson?.exists &&
      (indexJs?.exists ||
        entries.some((e) => e.path.endsWith("/src") && e.exists)),
  );

  const requestedFiles = entries.filter(
    (e) => e.kind === "file" || /\.[a-z0-9]+$/i.test(e.path),
  );
  const allRequestedFilesExist =
    requestedFiles.length > 0 && requestedFiles.every((e) => e.exists);

  let greenfieldScaffold = false;
  if (isNewScaffoldTask(message)) {
    const hasExistingAppFile = entries.some(
      (e) =>
        e.exists &&
        (e.kind === "file" || /\.(html|css|js|vue|tsx?)$/i.test(e.path)),
    );
    if (!hasExistingAppFile) {
      const scanRoot =
        context.lockedProjectRoot && context.lockedProjectRoot !== "."
          ? context.lockedProjectRoot
          : context.activeProjectRoot && context.activeProjectRoot !== "."
            ? context.activeProjectRoot
            : projectRoot ?? ".";
      await appendGreenfieldPreflightEntries(entries, scanRoot);
      greenfieldScaffold = !entries.some(
        (e) =>
          e.exists &&
          (e.kind === "file" || /\.(html|css|js)$/i.test(e.path)),
      );
    }
  }

  const actions = buildFilesystemActions(entries, message);
  const layoutNotes = await discoverLayoutNotes(projectRoot, message);

  return {
    message,
    projectRoot,
    entries,
    actions,
    layoutNotes,
    scaffoldPresent,
    allRequestedFilesExist,
    greenfieldScaffold,
    hadTargets: entries.length > 0,
    awarenessPassComplete: entries.length > 0,
    projectRootsScanned: [
      ...new Set(
        [
          projectRoot,
          context.lockedProjectRoot,
          context.activeProjectRoot,
          ...(context.mentionedProjects ?? []),
        ]
          .filter(Boolean)
          .map((r) => String(r).split("/")[0]),
      ),
    ],
  };
}

export function beginTurnAwareness(threadId, preflight) {
  const autoComplete = Boolean(preflight?.awarenessPassComplete);
  turnAwareness.set(threadId, {
    preflight: preflight ?? null,
    complete: autoComplete,
    reason: autoComplete ? "server-awareness-pass" : null,
  });
}

export function clearTurnAwareness(threadId) {
  turnAwareness.delete(threadId);
}

export function isAwarenessComplete(threadId) {
  return turnAwareness.get(threadId)?.complete === true;
}

export function completeTurnAwareness(threadId, reason = "read-only-tool") {
  const state = turnAwareness.get(threadId);
  if (!state) return;
  state.complete = true;
  state.reason = reason;
}

export function getTurnAwareness(threadId) {
  return turnAwareness.get(threadId) ?? null;
}

/** True when Phase 1 awareness requirements are met for this turn. */
export function isAwarenessSatisfied(threadId, toolEvents = []) {
  if (isAwarenessComplete(threadId)) return true;

  const preflight = getTurnAwareness(threadId)?.preflight;
  if (preflight?.greenfieldScaffold) return true;

  for (const event of toolEvents ?? []) {
    if (event.type !== "tool_result") continue;
    if (!AWARENESS_PROBE_TOOLS.has(event.name)) continue;
    if (!isSuccessfulToolResult(event)) continue;
    return true;
  }

  return false;
}

export function ensureAwarenessComplete(threadId, toolEvents = [], reason = "tool-satisfied") {
  if (!isAwarenessSatisfied(threadId, toolEvents)) return false;
  if (!isAwarenessComplete(threadId)) {
    completeTurnAwareness(threadId, reason);
  }
  return true;
}

/**
 * Update a single path in turn awareness after mkdir/write — keeps EXISTS/MISSING current.
 */
export async function refreshAwarenessEntry(threadId, relativePath) {
  const state = turnAwareness.get(threadId);
  if (!state?.preflight) return;

  const path = String(relativePath ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
  if (!path) return;

  let exists = false;
  let kind = null;
  try {
    const stat = await fs.stat(resolveSafePath(path));
    exists = true;
    kind = stat.isDirectory() ? "dir" : "file";
  } catch {
    exists = false;
    kind = null;
  }

  const preflight = state.preflight;
  const entries = preflight.entries ?? [];
  const idx = entries.findIndex((e) => e.path === path);
  const row = { path, exists, kind };
  if (idx >= 0) {
    entries[idx] = row;
  } else {
    entries.push(row);
  }
  preflight.entries = entries;
  preflight.actions = buildFilesystemActions(entries, preflight.message ?? "");
}

/** Always returns a non-empty brief for coding turns. */
export function buildWorkspaceAwarenessBrief(preflight) {
  const lines = [
    "[Workspace awareness — one full disk pass BEFORE plan or execute]",
    "Mandatory order: AWARENESS (this action plan) → PLAN (mirror SKIP/CREATE/UPDATE/DELETE) → EXECUTE.",
  ];

  if (preflight?.greenfieldScaffold) {
    lines.push(...GREENFIELD_BRIEF_LINES);
  } else if (!preflight?.entries?.length) {
    lines.push(
      "",
      "No target paths were pre-scanned.",
      "Complete awareness in one pass before update_task_plan:",
      "  • inspect_codebase or list_directory on the active project root",
      "  • search_files with no matches also completes awareness for new apps",
      "  • inspect_ast (outline) on every code file you may touch — answer from AST when sufficient; read_file if exact source needed",
      "Then plan only the work that is still needed (skip EXISTS creates, skip absent deletes).",
    );
    lines.push("", FILESYSTEM_AWARENESS_RULES);
    return lines.join("\n");
  }

  const inventory = preflight.entries.filter(
    (e) =>
      e.exists ||
      pathExplicitlyReferenced(preflight.message, e.path) ||
      preflight.actions?.find((a) => a.path === e.path)?.explicit,
  );
  const inventoryRows = inventory.length ? inventory : preflight.entries.slice(0, 12);

  lines.push("", "On-disk inventory (relevant paths only):");
  for (const { path, exists, kind } of inventoryRows) {
    const tag = exists ? "EXISTS" : "MISSING";
    const suffix = kind ? ` (${kind})` : "";
    lines.push(`  ${tag}: ${path}${suffix}`);
  }
  if (preflight.entries.length > inventoryRows.length) {
    lines.push(
      `  … ${preflight.entries.length - inventoryRows.length} other path(s) omitted (not part of this request)`,
    );
  }

  lines.push(buildFilesystemActionPlanBlock(preflight.actions));
  if (preflight.layoutNotes?.length) {
    lines.push("");
    for (const note of preflight.layoutNotes) lines.push(`  ⚠ ${note}`);
  }
  lines.push("", FILESYSTEM_AWARENESS_RULES);

  return lines.join("\n");
}

/** @deprecated use buildWorkspaceAwarenessBrief */
export function buildWorkspacePreflightBrief(preflight) {
  return buildWorkspaceAwarenessBrief(preflight);
}

export { FILESYSTEM_AWARENESS_RULES } from "./filesystemAwareness.js";

export function buildExplicitToolRunbookBrief() {
  return (
    "[Direct tool runbook — tools only, but plan still required]\n" +
    "Honor the filesystem action plan: SKIP rows need no tool calls.\n" +
    "Call update_task_plan from the action plan, then execute non-SKIP steps only.\n" +
    "No web_search unless a tool fails."
  );
}
