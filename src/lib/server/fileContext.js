import { dedupeProjectPrefix } from "./pathUtils.js";
import { isPlanTodoFilePath } from "./planFreeze.js";
import { formatWorkspaceFileMapLines } from "./workspaceFileMap.js";

const threadContext = new Map();

const PROJECT_INTERNAL_PREFIX =
  /^(src|lib|app|tests?|components|pages|views|public|server|client|api|dist|build|styles|assets)\//;

const MAX_RECENT = 24;
const MAX_LISTINGS = 8;

function normalizePath(p) {
  return String(p ?? ".")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "") || ".";
}

export function getFileContextState(threadId) {
  if (!threadContext.has(threadId)) {
    threadContext.set(threadId, {
      recentFiles: [],
      directoryListings: [],
      mentionedProjects: [],
      workspaceFileMap: null,
    });
  }
  return threadContext.get(threadId);
}

export function clearFileContext(threadId) {
  const prev = threadContext.get(threadId);
  threadContext.set(threadId, {
    recentFiles: [],
    directoryListings: [],
    mentionedProjects: prev?.mentionedProjects ?? [],
    workspaceFileMap: null,
  });
}

/** @param {import("./workspaceFileMap.js").WorkspaceFileMap | null} map */
export function recordWorkspaceFileMap(threadId, map) {
  if (!map) return;
  getFileContextState(threadId).workspaceFileMap = map;
}

export function getWorkspaceFileMap(threadId) {
  return getFileContextState(threadId).workspaceFileMap ?? null;
}

export function recordProjectHint(threadId, projectRoot) {
  if (!projectRoot || projectRoot === ".") return;
  const state = getFileContextState(threadId);
  const root = normalizePath(projectRoot);
  state.mentionedProjects = [
    root,
    ...state.mentionedProjects.filter((p) => p !== root),
  ].slice(0, 6);
}

export function recordFileAccess(threadId, filePath, action, meta = {}) {
  const state = getFileContextState(threadId);
  const path = normalizePath(filePath);
  if (path === ".") return;

  state.recentFiles = [
    { path, action, at: Date.now(), ...meta },
    ...state.recentFiles.filter((r) => r.path !== path),
  ].slice(0, MAX_RECENT);
}

export function recordDirectoryListing(threadId, dirPath, summary) {
  const state = getFileContextState(threadId);
  const dir = normalizePath(dirPath);
  state.directoryListings = [
    { dir, summary: String(summary ?? "").slice(0, 1200), at: Date.now() },
    ...state.directoryListings.filter((d) => d.dir !== dir),
  ].slice(0, MAX_LISTINGS);
}

export function recordInspectResult(threadId, { projectRoot, projectType, entryHints, files }) {
  if (projectRoot) recordProjectHint(threadId, projectRoot);
  if (entryHints?.length) {
    for (const hint of entryHints) {
      const full =
        projectRoot && projectRoot !== "."
          ? `${projectRoot}/${hint.replace(/^\.\//, "")}`
          : hint;
      recordFileAccess(threadId, full, "entry-hint", { projectType });
    }
  }
  if (files && projectRoot) {
    const topFiles = String(files)
      .split("\n")
      .slice(0, 15)
      .map((line) => {
        const rel = line.replace(/^(dir|file)\s+/, "").trim();
        return rel ? `${projectRoot}/${rel}` : null;
      })
      .filter(Boolean);
    for (const path of topFiles) {
      recordFileAccess(threadId, path, "listed", { projectRoot });
    }
  }
}

export function getKnownPaths(threadId) {
  return getFileContextState(threadId).recentFiles.map((r) => r.path);
}

export function pathUnderProject(filePath, projectRoot) {
  const path = normalizePath(filePath);
  const root = normalizePath(projectRoot);
  if (root === ".") return true;
  return path === root || path.startsWith(`${root}/`);
}

export function looksProjectInternal(relativePath) {
  return PROJECT_INTERNAL_PREFIX.test(normalizePath(relativePath));
}

export function suggestPrefixedPath(rawPath, projectRoot) {
  const raw = normalizePath(rawPath);
  const root = normalizePath(projectRoot);
  if (root === "." || raw.startsWith(`${root}/`) || raw === root) return raw;
  if (looksProjectInternal(raw)) return `${root}/${raw}`;
  return `${root}/${raw.replace(/^\.\//, "")}`;
}

export function validateWritePath(
  inputPath,
  { activeProject, cwd, userMessage, knownPaths = [] } = {},
) {
  const project = activeProject && activeProject !== "." ? normalizePath(activeProject) : null;
  const raw = dedupeProjectPrefix(normalizePath(inputPath), project);

  if (isPlanTodoFilePath(raw)) {
    return { allowed: true, path: raw };
  }

  if (project && looksProjectInternal(raw) && !pathUnderProject(raw, project)) {
    const corrected = suggestPrefixedPath(raw, project);
    return {
      allowed: false,
      corrected,
      reason: "missing_project_prefix",
      message:
        `PATH REJECTED: "${raw}" is a project-internal path without the project prefix.\n` +
        `Active project: "${project}".\n` +
        `Use "${corrected}" instead.\n` +
        `Never write bare src/, lib/, app/, or components/ at workspace root when a project is active.`,
    };
  }

  if (project && !pathUnderProject(raw, project)) {
    const segments = raw.split("/");
    const topLevel = segments[0];
    const knownProject = knownPaths.find((p) => p.startsWith(`${topLevel}/`));
    if (knownProject && topLevel !== project && looksProjectInternal(raw)) {
      const tail = raw.includes("/") ? raw.slice(raw.indexOf("/") + 1) : raw;
      const corrected = `${project}/${tail}`;
      return {
        allowed: false,
        corrected,
        reason: "wrong_project_root",
        message:
          `PATH REJECTED: "${raw}" is outside active project "${project}".\n` +
          `You recently worked under "${topLevel}/" but active project is "${project}".\n` +
          `Rewrite to "${corrected}" or call inspect_codebase to confirm the correct root.`,
      };
    }

    if (looksProjectInternal(raw) || segments.length > 1) {
      const corrected = suggestPrefixedPath(raw, project);
      return {
        allowed: false,
        corrected,
        reason: "outside_active_project",
        message:
          `PATH REJECTED: "${raw}" is outside active project "${project}".\n` +
          `All code edits must stay under "${project}/".\n` +
          `Did you mean "${corrected}"?`,
      };
    }
  }

  if (!project && looksProjectInternal(raw) && cwd === ".") {
    const hint = extractProjectFromMessage(userMessage);
    if (hint) {
      const corrected = `${normalizePath(hint)}/${raw}`;
      return {
        allowed: false,
        corrected,
        reason: "no_active_project",
        message:
          `PATH REJECTED: "${raw}" looks like an app-internal path but no active project is set.\n` +
          `Did you mean "${corrected}"? Call inspect_codebase on the project folder first to lock the root.`,
      };
    }
    return {
      allowed: false,
      corrected: null,
      reason: "no_active_project",
      message:
        `PATH REJECTED: "${raw}" looks like an app-internal path at workspace root.\n` +
        `Call inspect_codebase first to set the active project root, then use "<project>/src/..." paths.`,
    };
  }

  return { allowed: true, path: raw };
}

function extractProjectFromMessage(message) {
  if (!message) return null;
  const patterns = [
    /\b(?:in|at|under|inside|from|fix|for)\s+(?:the\s+)?([a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)?)\b/i,
    /\b([a-zA-Z0-9._-]+(?:-app|_app|\/[a-zA-Z0-9._-]+))\b/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1] && !match[1].includes("://") && !/\.(vue|ts|js|py|rs|go)$/i.test(match[1])) {
      return match[1].split("/")[0];
    }
  }
  return null;
}

export function validateReadPath(inputPath, { activeProject, cwd } = {}) {
  const raw = normalizePath(inputPath);
  const project = activeProject && activeProject !== "." ? normalizePath(activeProject) : null;

  if (project && looksProjectInternal(raw) && !pathUnderProject(raw, project)) {
    return {
      allowed: true,
      path: suggestPrefixedPath(raw, project),
      rewritten: true,
      message: `Path rewritten to "${suggestPrefixedPath(raw, project)}" (active project: ${project}).`,
    };
  }

  if (!project && looksProjectInternal(raw) && cwd !== ".") {
    const fromCwd = normalizePath(`${cwd}/${raw}`.replace(/\/+/g, "/"));
    return { allowed: true, path: fromCwd, rewritten: true };
  }

  return { allowed: true, path: raw, rewritten: false };
}

export function buildFileContextBlock(threadId, { activeProject, cwd, lockedProjectRoot } = {}) {
  const state = getFileContextState(threadId);
  const lock = lockedProjectRoot && lockedProjectRoot !== "." ? lockedProjectRoot : null;
  const project = lock ?? (activeProject && activeProject !== "." ? activeProject : null);

  const lines = [
    "File location memory (authoritative — copy paths exactly, never invent locations):",
    "- Call search_files before search_replace or delete_file — server requires the path in search results. write_file may create new files without a search hit.",
    `- Workspace-relative cwd: ${normalizePath(cwd)}`,
  ];

  if (lock) {
    lines.push(
      `- LOCKED project root (mandatory for ALL tools this job): ${lock}`,
      `- EVERY path must start with "${lock}/" — server rewrites or blocks paths outside this root`,
      `- Subfolders OK: ${lock}/api-server/index.js — sibling top-level folders are FORBIDDEN`,
    );
  } else if (project) {
    lines.push(
      `- Active project root: ${project}`,
      `- REQUIRED path form for code files: ${project}/src/... (or other dirs under ${project}/)`,
      `- FORBIDDEN: bare src/, lib/, app/, components/ at workspace root while this project is active`,
    );
  } else {
    lines.push(
      "- Active project: NONE — call inspect_codebase before any write_file on code",
    );
  }

  if (state.mentionedProjects.length) {
    lines.push(`- Known project folders: ${state.mentionedProjects.join(", ")}`);
  }

  if (state.recentFiles.length) {
    lines.push("", "Recently touched paths (reuse these exact strings):");
    for (const entry of state.recentFiles.slice(0, 14)) {
      lines.push(`  • ${entry.path}  [${entry.action}]`);
    }
  }

  if (state.directoryListings.length) {
    lines.push("", "Recent directory listings:");
    for (const listing of state.directoryListings.slice(0, 3)) {
      lines.push(`  ${listing.dir}/:`);
      const preview = listing.summary.split("\n").slice(0, 8).join("\n");
      lines.push(preview.split("\n").map((l) => `    ${l}`).join("\n"));
    }
  }

  if (state.workspaceFileMap?.paths?.length) {
    lines.push("", formatWorkspaceFileMapLines(state.workspaceFileMap, { maxChars: 6000 }));
  }

  return lines.join("\n");
}

export function formatReadFileHeader(filePath, { activeProject } = {}) {
  const path = normalizePath(filePath);
  const project =
    activeProject && activeProject !== "." ? normalizePath(activeProject) : null;
  const inProject = project && pathUnderProject(path, project);
  return [
    `=== FILE: ${path} ===`,
    project ? `=== PROJECT: ${project}${inProject ? " (inside active project)" : " (OUTSIDE active project — check path)"} ===` : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function hasPathWarningsInResults(toolEvents) {
  return hasUnresolvedPathWarnings(toolEvents);
}

/** Path issues still blocking handoff — ignores stale rejections fixed by later writes/verify. */
export function hasUnresolvedPathWarnings(toolEvents) {
  let lastIssueIndex = -1;

  for (let i = 0; i < toolEvents.length; i++) {
    const e = toolEvents[i];
    if (e.type !== "tool_result") continue;
    const content = e.content ?? "";
    if (
      /\bPATH REJECTED:/i.test(content) ||
      /\bWARNING:.*(?:NOT inside|outside active project|workspace root instead)/i.test(
        content,
      )
    ) {
      lastIssueIndex = i;
    }
  }

  if (lastIssueIndex < 0) return false;

  for (let i = lastIssueIndex + 1; i < toolEvents.length; i++) {
    const e = toolEvents[i];
    if (e.type !== "tool_result") continue;
    const content = e.content ?? "";

    if (
      (e.name === "write_file" || e.name === "search_replace") &&
      /\bWrote \d+ bytes to /i.test(content) &&
      !/\bWARNING:/i.test(content)
    ) {
      return false;
    }

    if (e.name === "verify_project" && /OVERALL:\s*PASS/i.test(content)) {
      if (!/WORKSPACE STRAY PATHS/i.test(content)) return false;
    }

    if (e.name === "cleanup_stray_paths" && /Removed:/i.test(content)) {
      const remaining = toolEvents.slice(i + 1);
      const laterVerifyPass = remaining.some(
        (r) =>
          r.type === "tool_result" &&
          r.name === "verify_project" &&
          /OVERALL:\s*PASS/i.test(r.content ?? "") &&
          !/WORKSPACE STRAY PATHS/i.test(r.content ?? ""),
      );
      if (laterVerifyPass) return false;
    }
  }

  return true;
}

export function getRejectedWritePaths(toolEvents) {
  return toolEvents
    .filter(
      (e) =>
        e.name === "write_file" &&
        e.type === "tool_result" &&
        /\bPATH REJECTED:/i.test(e.content ?? ""),
    )
    .map((e) => e.args?.path)
    .filter(Boolean);
}
