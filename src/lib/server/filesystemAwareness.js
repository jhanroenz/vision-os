import { resolveSafePath } from "./workspace.js";
import fs from "node:fs/promises";
import {
  wouldCreateNestedProjectPath,
  normalizeBashCommandForLockedRoot,
} from "./bashPathNormalize.js";
/** @typedef {'create' | 'update' | 'delete' | 'inspect'} PathIntent */

/**
 * Infer what the user wants to do with a path from the message text.
 * @param {string} message
 * @param {string} path
 * @returns {PathIntent}
 */
export function inferPathIntent(message, path) {
  const text = String(message ?? "");
  if (!text || !path) return "inspect";

  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const base = path.split("/").pop() ?? path;

  if (
    new RegExp(
      `\\b(?:delete|remove|rm\\s+-rf?)\\s+(?:-rf\\s+)?["']?${escaped}["']?`,
      "i",
    ).test(text) ||
    new RegExp(
      `\\b(?:delete|remove)\\s+[^.\\n]{0,40}\\b${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    ).test(text)
  ) {
    return "delete";
  }

  if (new RegExp(`\\bmkdir\\s+(?:-p\\s+)?["']?${escaped}["']?`, "i").test(text)) {
    return "create";
  }

  if (new RegExp(`\\bwrite_file\\s+${escaped}\\b`, "i").test(text)) {
    if (/\b(?:update|fix|modify|change|edit|patch|correct)\b/i.test(text)) {
      return "update";
    }
    if (
      /\b(?:create|scaffold|mkdir|exporting|initialize|init|setup|set up|new|add)\b/i.test(
        text,
      )
    ) {
      return "create";
    }
    return "update";
  }

  if (pathExplicitlyReferenced(message, path)) {
    if (/\b(?:delete|remove|get rid of|clean up)\b/i.test(text)) return "delete";
    if (/\b(?:update|fix|modify|change|edit|refactor|patch|correct)\b/i.test(text)) {
      return "update";
    }
    return "create";
  }

  return "inspect";
}

/** Paths the user explicitly named (tools, mkdir, delete) — not broad prose mentions. */
export function pathExplicitlyReferenced(message, targetPath) {
  const text = String(message ?? "");
  const path = normalizePathForMatch(targetPath);
  if (!text || !path) return false;

  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const base = path.split("/").pop() ?? path;

  if (new RegExp(`(?:^|[\\s"'(])${escaped}(?:$|[\\s"'.,)])`).test(text)) return true;
  if (
    new RegExp(
      `\\b(?:write_file|read_file|search_replace|delete_file|read_files)\\s+${escaped}\\b`,
      "i",
    ).test(text)
  ) {
    return true;
  }
  if (new RegExp(`\\bmkdir\\s+(?:-p\\s+)?["']?${escaped}["']?`, "i").test(text)) {
    return true;
  }
  if (
    new RegExp(
      `\\b(?:delete|remove|rm\\s+-rf?)\\s+[^\\n]{0,40}\\b${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    ).test(text)
  ) {
    return true;
  }
  return false;
}

/**
 * Recommended action from disk state + user intent.
 * @param {PathIntent} intent
 * @param {boolean} exists
 */
export function recommendFilesystemAction(intent, exists) {
  switch (intent) {
    case "create":
      return exists
        ? {
            action: "skip",
            execute: "skip — do not mkdir or write_file",
            planHint: "mark done (already exists)",
          }
        : {
            action: "create",
            execute: "mkdir and/or write_file",
            planHint: "create on disk",
          };
    case "update":
      return exists
        ? {
            action: "update",
            execute: "read_file then search_replace or write_file",
            planHint: "read then update",
          }
        : {
            action: "create",
            execute: "write_file (create new)",
            planHint: "create file then write content",
          };
    case "delete":
      return exists
        ? {
            action: "delete",
            execute: "run_bash rm or cleanup_strays",
            planHint: "delete from disk",
          }
        : {
            action: "skip",
            execute: "skip — already absent, do not rm",
            planHint: "skip (nothing to delete)",
          };
    default:
      return exists
        ? {
            action: "verify",
            execute: "read_file before changing",
            planHint: "read_file then decide update or skip",
          }
        : {
            action: "skip",
            execute: "skip — not requested",
            planHint: "omit from plan (path not in scope)",
          };
  }
}

/** Extract delete targets from natural language and bash snippets. */
export function extractDeletePathsFromMessage(message) {
  const paths = new Set();
  const text = String(message ?? "");

  for (const m of text.matchAll(
    /\b(?:delete|remove)\s+(?:the\s+)?(?:file|dir(?:ectory)?|folder)?\s*["']?([a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*)/gi,
  )) {
    paths.add(m[1].replace(/\\/g, "/"));
  }

  for (const m of text.matchAll(
    /\brm\s+(?:-rf?|--recursive)?\s+["']?([a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*)/gi,
  )) {
    paths.add(m[1].replace(/\\/g, "/"));
  }

  return [...paths];
}

/** Build per-path action rows from scanned entries + message intent. */
export function buildFilesystemActions(entries, message) {
  return (entries ?? []).map(({ path, exists, kind }) => {
    const intent = inferPathIntent(message, path);
    const recommendation = recommendFilesystemAction(intent, exists);
    const explicit = pathExplicitlyReferenced(message, path);
    return { path, exists, kind, intent, explicit, recommendation };
  });
}

/** Rows that should drive update_task_plan — omit out-of-scope probe paths. */
export function filterActionableFilesystemRows(actions) {
  return (actions ?? []).filter((row) => {
    if (row.explicit) return true;
    if (row.intent === "delete" || row.intent === "update") return true;
    if (row.intent === "create") return row.explicit || !row.exists;
    if (row.recommendation?.action === "skip") return false;
    if (row.recommendation?.action === "verify") return row.explicit;
    return row.recommendation?.action !== "skip";
  });
}

export function extractMkdirPathsFromCommand(command) {
  const paths = [];
  const text = String(command ?? "");
  for (const m of text.matchAll(
    /\bmkdir\s+(?:-p\s+)?["']?([a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*)/gi,
  )) {
    paths.push(m[1].replace(/\\/g, "/"));
  }
  return paths;
}

export function extractRmPathsFromCommand(command) {
  const paths = [];
  const text = String(command ?? "");
  for (const m of text.matchAll(
    /\brm\s+(?:-rf?|--recursive)?\s+["']?([a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*)/gi,
  )) {
    paths.push(m[1].replace(/\\/g, "/"));
  }
  return paths;
}

function normalizePathForMatch(p) {
  return String(p ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/^\.\//, "");
}

/** Match a tool path to the closest awareness row. */
export function findFilesystemAction(actions, targetPath) {
  if (!actions?.length || !targetPath) return null;
  const target = normalizePathForMatch(targetPath);
  let best = null;
  let bestLen = -1;
  for (const row of actions) {
    const rowPath = normalizePathForMatch(row.path);
    if (target === rowPath || target.startsWith(`${rowPath}/`)) {
      if (rowPath.length > bestLen) {
        best = row;
        bestLen = rowPath.length;
      }
    }
  }
  return best;
}

/**
 * Match write_file targets — exact file rows only; directory ancestors must not
 * drive SKIP for child file paths (e.g. todo/src must not SKIP todo/src/index.css).
 */
export function findFilesystemActionForWrite(actions, targetPath) {
  if (!actions?.length || !targetPath) return null;
  const target = normalizePathForMatch(targetPath);

  const exact = actions.find((row) => normalizePathForMatch(row.path) === target);
  if (exact) return exact;

  let best = null;
  let bestLen = -1;
  for (const row of actions) {
    if (row.kind === "dir") continue;
    const rowPath = normalizePathForMatch(row.path);
    if (!rowPath || rowPath === target) continue;
    if (target.startsWith(`${rowPath}/`) && row.kind === "file") {
      if (rowPath.length > bestLen) {
        best = row;
        bestLen = rowPath.length;
      }
    }
  }
  return best;
}

async function pathExists(relativePath) {
  try {
    await fs.stat(resolveSafePath(relativePath));
    return true;
  } catch {
    return false;
  }
}

/** True only when path exists on disk and is a regular file (not a directory). */
export async function targetFileExists(relativePath) {
  try {
    const stat = await fs.stat(resolveSafePath(relativePath));
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Hard gate: skip redundant create/delete work per awareness action plan.
 * @returns {{ blocked: boolean, message?: string, statusLine?: string }}
 */
export async function checkFilesystemAwarenessGate(
  toolName,
  args,
  { threadId, getTurnAwareness, getLockedProjectRoot },
) {
  const state = getTurnAwareness(threadId);
  const actions = state?.preflight?.actions;
  if (!state?.complete) return { blocked: false };

  const lockedRoot = getLockedProjectRoot?.(threadId) ?? null;

  if (toolName === "write_file" && args?.path) {
    const filePath = args.path;

    if (!(await targetFileExists(filePath))) {
      return { blocked: false };
    }

    const row = actions?.length ? findFilesystemActionForWrite(actions, filePath) : null;
    const intent =
      row?.intent ?? inferPathIntent(state.preflight?.message ?? "", filePath);

    if (intent === "create" || (row?.recommendation?.action === "skip" && row.intent === "create")) {
      return {
        blocked: true,
        statusLine: "STATUS: SKIP (filesystem awareness — already exists)",
        message:
          `Skipped ${toolName} on "${filePath}": path already EXISTS (intent: create).\n` +
          `Do not recreate existing files. read_file to verify content, or search_replace to update.\n` +
          `Next: mark_plan_step with {"step_id":"<id>","status":"done"} — do not retry write_file.`,
      };
    }

    if (!row && (await pathExists(filePath))) {
      if (intent === "create") {
        return {
          blocked: false,
          statusLine: "STATUS: INFO (file exists — overwriting with updated content)",
        };
      }
    }
  }

  if (toolName === "run_bash" && args?.command) {
    let cmd = String(args.command);
    const cwd = args.cwd ?? lockedRoot ?? ".";

    if (lockedRoot && lockedRoot !== ".") {
      const nested = wouldCreateNestedProjectPath(cmd, lockedRoot, cwd);
      if (nested) {
        return {
          blocked: true,
          statusLine: "STATUS: BLOCKED (nested project path)",
          message:
            `Blocked run_bash: mkdir "${nested}" would nest inside locked root "${lockedRoot}".\n` +
            `You are already inside ${lockedRoot}/ — use mkdir -p src (not ${lockedRoot}/src).\n` +
            `Paths in commands must be relative to the locked project root.`,
        };
      }
      const normalized = normalizeBashCommandForLockedRoot(cmd, lockedRoot, cwd);
      cmd = normalized.command;
    }

    for (const dir of extractMkdirPathsFromCommand(cmd)) {
      const row = actions?.length ? findFilesystemAction(actions, dir) : null;
      const exists = row?.exists ?? (await pathExists(dir));
      if (exists) {
        return {
          blocked: true,
          statusLine: "STATUS: SKIP (filesystem awareness — dir exists)",
          message:
            `Skipped mkdir for "${dir}": already EXISTS on disk.\n` +
            `Do not rerun mkdir/npm init. read_file to verify, then continue with missing files only.`,
        };
      }
    }

    if (/\bnpm\s+init\b/i.test(cmd)) {
      const pkgRow = actions?.find((a) => a.path.endsWith("package.json"));
      const pkgPath = pkgRow?.path ?? (lockedRoot && lockedRoot !== "." ? `${lockedRoot}/package.json` : null);
      if (pkgPath && (pkgRow?.exists || (await pathExists(pkgPath)))) {
        return {
          blocked: true,
          statusLine: "STATUS: SKIP (filesystem awareness — package.json exists)",
          message:
            `Skipped npm init: package.json already EXISTS${pkgRow ? ` at "${pkgRow.path}"` : ""}.\n` +
            `read_file to verify content instead of re-init.`,
        };
      }
    }

    for (const rmPath of extractRmPathsFromCommand(cmd)) {
      const row = actions?.length ? findFilesystemAction(actions, rmPath) : null;
      const exists = row?.exists ?? (await pathExists(rmPath));
      const intent = row?.intent ?? "delete";
      if (!exists && intent === "delete") {
        return {
          blocked: true,
          statusLine: "STATUS: SKIP (filesystem awareness — already absent)",
          message:
            `Skipped rm for "${rmPath}": path does not exist (intent: delete).\n` +
            `Nothing to delete — mark the delete step done and continue.`,
        };
      }
    }
  }

  return { blocked: false };
}

function actionLabel(row) {
  const { recommendation, intent, exists } = row;
  const tag = recommendation.action.toUpperCase();
  const state = exists ? "EXISTS" : "MISSING";
  return `${tag.padEnd(6)} ${row.path} (${state}, intent: ${intent}) — ${recommendation.planHint}`;
}

/** Filesystem-aware plan section for awareness brief and plan phase. */
export function buildFilesystemActionPlanBlock(actions) {
  const actionable = filterActionableFilesystemRows(actions);
  if (!actionable.length) {
    if (!actions?.length) return "";
    return [
      "",
      "Filesystem action plan: no path-specific create/update/delete work detected from this request.",
      "Inspect the project (search_files / read_file) and plan only what Master Jan asked for — do not scaffold extra manifests or other languages.",
    ].join("\n");
  }

  const lines = [
    "",
    "Filesystem action plan (paths tied to this request — base update_task_plan on these only):",
    "  CREATE → only when MISSING and requested | UPDATE → read then patch | DELETE → only when EXISTS | SKIP → no tool call",
  ];

  for (const row of actionable) {
    lines.push(`  ${actionLabel(row)}`);
  }

  const skippable = actionable.filter((a) => a.recommendation.action === "skip");
  if (skippable.length) {
    lines.push(
      "",
      `${skippable.length} listed path(s) need no work — omit them from the plan or mark those steps done.`,
    );
  }

  return lines.join("\n");
}

export const FILESYSTEM_AWARENESS_RULES = `Filesystem-smart execution (server-enforced):
- Awareness scans paths relevant to this request and detected project type — not every manifest for every language.
- CREATE only for paths Master Jan asked for; if EXISTS → SKIP (no recreate).
- UPDATE: if EXISTS → read_file then patch; if MISSING and requested → create that file only.
- DELETE: if MISSING → SKIP; if EXISTS and requested → delete.
- Do not plan pyproject.toml / Cargo.toml / go.mod unless that stack is detected or explicitly requested.
- update_task_plan mirrors the action plan below — omit SKIP rows and out-of-scope probes.`;
