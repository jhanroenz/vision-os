import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafePath, sanitizeWorkspaceRelativePath } from "../workspace.js";
import { detectProjectRoot } from "./context.js";

async function pathExists(relativePath) {
  try {
    await fs.access(resolveSafePath(relativePath));
    return true;
  } catch {
    return false;
  }
}

function normalizeRel(p) {
  return (p || ".").replace(/\\/g, "/").replace(/\/+$/, "") || ".";
}

export async function resolveCodebasePath(threadId, inputPath, {
  getThreadCwd,
  getActiveProjectRoot,
}) {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("Path is required");
  }

  let raw = inputPath.trim().replace(/\\/g, "/");
  const cwd = normalizeRel(getThreadCwd(threadId));
  const activeProject = getActiveProjectRoot(threadId);

  // Avoid todo/todo/... when active project is already "todo" and path repeats prefix
  if (activeProject && activeProject !== ".") {
    const prefix = `${activeProject}/`;
    if (raw === activeProject) raw = activeProject;
    else if (raw.startsWith(prefix)) raw = raw.slice(prefix.length);
  }

  const looksProjectRelative = /^(src|lib|app|tests?)\//.test(raw);

  // Prefer project/cwd prefix for src/lib paths — avoids stale files at workspace root
  if (looksProjectRelative) {
    if (activeProject && activeProject !== ".") {
      const prefixed = normalizeRel(path.join(activeProject, raw));
      if (await pathExists(prefixed)) {
        return { path: prefixed, resolvedFrom: "activeProject" };
      }
      return { path: prefixed, resolvedFrom: "activeProject-inferred" };
    }

    if (cwd !== ".") {
      const fromCwd = normalizeRel(path.join(cwd, raw));
      if (await pathExists(fromCwd)) {
        return { path: fromCwd, resolvedFrom: "cwd" };
      }
      return { path: fromCwd, resolvedFrom: "cwd-inferred" };
    }
  }

  if (await pathExists(raw)) {
    if (
      activeProject &&
      looksProjectRelative &&
      activeProject !== "." &&
      !raw.startsWith(`${activeProject}/`)
    ) {
      const prefixed = normalizeRel(path.join(activeProject, raw));
      return { path: prefixed, resolvedFrom: "activeProject-over-root" };
    }
    return { path: raw, resolvedFrom: "existing" };
  }

  const candidates = [];

  if (activeProject) {
    candidates.push({
      path: normalizeRel(path.join(activeProject, raw)),
      resolvedFrom: "activeProject",
    });
  }

  if (cwd !== ".") {
    candidates.push({
      path: normalizeRel(path.join(cwd, raw)),
      resolvedFrom: "cwd",
    });
  }

  for (const candidate of candidates) {
    if (candidate.path !== raw && (await pathExists(candidate.path))) {
      return candidate;
    }
  }

  if (candidates.length > 0) {
    return candidates[0];
  }

  const suggestion = activeProject
    ? `${activeProject}/${raw}`
    : cwd !== "."
      ? `${cwd}/${raw}`
      : raw;

  throw new Error(
    `Ambiguous path "${raw}". No matching file found. ` +
      `Try: ${suggestion}. Call inspect_codebase to confirm project root.`,
  );
}

/**
 * Resolve write/search_replace targets. New files and scaffold paths may not exist yet.
 */
export async function resolveWriteCodebasePath(threadId, inputPath, deps) {
  try {
    return await resolveCodebasePath(threadId, inputPath, deps);
  } catch (error) {
    if (!/Ambiguous path/i.test(error.message ?? "")) throw error;

    let raw = inputPath.trim().replace(/\\/g, "/");
    const activeProject = deps.getActiveProjectRoot(threadId);
    if (activeProject && activeProject !== ".") {
      const prefix = `${activeProject}/`;
      if (raw.startsWith(prefix)) raw = raw.slice(prefix.length);
      else if (raw !== activeProject) {
        return {
          path: normalizeRel(path.join(activeProject, raw)),
          resolvedFrom: "activeProject-new",
        };
      }
    }

    return { path: normalizeRel(raw), resolvedFrom: "explicit-new" };
  }
}

export function isPackageManagerCommand(command) {
  return /\b(npm|pnpm|yarn|bun|cargo|go\s+(run|build|test)|python\s+-m|pip\s+install|composer|gradle|mvn)\b/.test(
    command,
  );
}

export async function resolveBashCwd(threadId, cwd, command, {
  getThreadCwd,
  getActiveProjectRoot,
}) {
  const base = cwd ?? getThreadCwd(threadId);
  const normalized = normalizeRel(base);

  // Honor explicit cwd from the tool call (e.g. new-app/api-server)
  if (cwd != null && String(cwd).trim() !== "" && normalized !== ".") {
    return sanitizeWorkspaceRelativePath(normalized);
  }

  if (isPackageManagerCommand(command) && !/\bnpm\s+create\b/.test(command)) {
    if (normalized !== ".") {
      return sanitizeWorkspaceRelativePath(normalized);
    }
    const active = getActiveProjectRoot(threadId);
    if (active && active !== ".") {
      return sanitizeWorkspaceRelativePath(active);
    }
    const detected = await detectProjectRoot(normalized);
    if (detected.projectRoot) {
      return detected.projectRoot;
    }
  }

  return sanitizeWorkspaceRelativePath(normalized, {
    fallback: sanitizeWorkspaceRelativePath(getThreadCwd(threadId)),
  });
}
