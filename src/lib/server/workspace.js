import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { detectProjectRoot } from "./codebase/context.js";
import { resolveProjectContext } from "./projectResolver.js";

const threadState = new Map();

function workspaceRootPosix() {
  return path.resolve(config.workspaceDir).replace(/\\/g, "/");
}

/**
 * Normalize any path input to a safe workspace-relative path.
 * Fixes corrupted cwd values that embed absolute workspace fragments.
 */
export function sanitizeWorkspaceRelativePath(input, { fallback = "." } = {}) {
  if (input == null || input === "") return fallback;

  let p = String(input).trim().replace(/\\/g, "/");
  const workspace = workspaceRootPosix();

  if (path.isAbsolute(p)) {
    const resolved = path.resolve(p).replace(/\\/g, "/");
    if (resolved === workspace || resolved.startsWith(`${workspace}/`)) {
      p = path.relative(workspace, resolved).replace(/\\/g, "/") || ".";
    } else {
      return fallback;
    }
  }

  // Strip accidental absolute workspace prefix stored as relative text
  const workspaceRel = workspace.replace(/^\//, "");
  if (p.startsWith(workspaceRel + "/") || p === workspaceRel) {
    p = p.slice(workspaceRel.length).replace(/^\//, "") || ".";
  }

  // Recover valid tail when absolute paths were concatenated as segments
  const marker = `${workspaceRel}/`;
  if (p.includes(marker)) {
    p = p.slice(p.lastIndexOf(marker) + marker.length) || fallback;
  }

  p = path.normalize(p.replace(/^\.\//, "")).replace(/\\/g, "/");
  if (p === "" || p === ".") return ".";

  const parts = p.split("/").filter(Boolean);
  const collapsed = [];
  for (const part of parts) {
    if (collapsed.length && collapsed[collapsed.length - 1] === part) continue;
    collapsed.push(part);
  }
  p = collapsed.join("/") || ".";

  if (p.startsWith("..") || p.split("/").includes("..")) {
    return fallback;
  }

  if (p.length > 180) {
    return fallback;
  }

  try {
    resolveSafePath(p);
    return p;
  } catch {
    return fallback;
  }
}

export function joinWorkspacePath(baseCwd, target) {
  const cleaned = String(target ?? "").trim().replace(/^["']|["']$/g, "");
  if (!cleaned || cleaned === "~" || cleaned === ".") {
    return sanitizeWorkspaceRelativePath(baseCwd);
  }

  if (path.isAbsolute(cleaned)) {
    return sanitizeWorkspaceRelativePath(cleaned);
  }

  const base = sanitizeWorkspaceRelativePath(baseCwd);
  const joined = path
    .normalize(path.join(base === "." ? "" : base, cleaned))
    .replace(/\\/g, "/");

  return sanitizeWorkspaceRelativePath(joined || ".");
}

export function extractProjectPathFromMessage(message) {
  if (!message) return null;

  const patterns = [
    /\b(?:in|at|under|inside|from|fix)\s+(?:the\s+)?([a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)+)\b/i,
    /\b(?:folder|directory|dir)\s+([a-zA-Z0-9._-]+)\b/i,
    /\b(?:write_file|read_file|search_replace)\s+([a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*)/i,
    /\b([a-zA-Z0-9._-]+)\/(?:src\/|package\.json|lib\/)/i,
    /\bmkdir\s+(?:-p\s+)?([a-zA-Z0-9._-]+)(?:\/|\b)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1] && !match[1].includes("://")) {
      return match[1];
    }
  }

  return null;
}

export function isNewScaffoldTask(message) {
  const text = String(message ?? "");
  return (
    /\b(create|scaffold|new|init|build|generate|make)\b/i.test(text) &&
    /\b(app|project|todo|vue|react|site|api)\b/i.test(text)
  );
}

export function inferScaffoldProjectDir(message) {
  const fromMsg = extractProjectPathFromMessage(message);
  if (fromMsg) return sanitizeWorkspaceRelativePath(fromMsg);
  return null;
}

export function getProjectResolution(threadId) {
  return getThreadState(threadId).projectResolution ?? null;
}

export function getScaffoldNote(threadId) {
  return getThreadState(threadId).scaffoldNote ?? null;
}

export function getThreadCwdFromMemory(threadId) {
  return sanitizeWorkspaceRelativePath(
    threadState.get(threadId)?.cwd ?? ".",
  );
}

export function getActiveProjectRoot(threadId) {
  const root = threadState.get(threadId)?.activeProjectRoot ?? null;
  return root ? sanitizeWorkspaceRelativePath(root, { fallback: null }) : null;
}

export function setThreadCwdInMemory(threadId, relativePath) {
  const state = getThreadState(threadId);
  state.cwd = sanitizeWorkspaceRelativePath(relativePath);
}

export function setActiveProjectRootInMemory(threadId, projectRoot) {
  const state = getThreadState(threadId);
  state.activeProjectRoot = projectRoot
    ? sanitizeWorkspaceRelativePath(projectRoot, { fallback: null })
    : null;
}

export async function syncActiveProjectRoot(threadId, startRelative = ".") {
  const start = sanitizeWorkspaceRelativePath(startRelative);
  const detected = await detectProjectRoot(start);
  if (detected.projectRoot) {
    setActiveProjectRootInMemory(threadId, detected.projectRoot);
  }
  return detected.projectRoot;
}

export function resolveSafePath(relativePath = ".") {
  const normalized = sanitizeWorkspaceRelativePath(relativePath);
  const resolved = path.resolve(config.workspaceDir, normalized);
  const workspace = path.resolve(config.workspaceDir);

  if (!resolved.startsWith(workspace + path.sep) && resolved !== workspace) {
    throw new Error(
      `Path "${relativePath}" is outside the allowed workspace: ${workspace}`,
    );
  }

  return resolved;
}

export function getThreadState(threadId) {
  if (!threadState.has(threadId)) {
    threadState.set(threadId, {
      cwd: ".",
      activeProjectRoot: null,
      lockedProjectRoot: null,
      workspaceRootLocked: false,
      conversationRootSource: "default",
      projectRootSource: null,
      scaffoldNote: null,
      workspaceInventory: null,
      projectResolution: null,
    });
  }
  return threadState.get(threadId);
}

/** Locked ONE project root for this job — all scoped tools must use it. */
export function getLockedProjectRoot(threadId) {
  const root =
    getThreadState(threadId).lockedProjectRoot ??
    getThreadState(threadId).activeProjectRoot ??
    null;
  return root ? sanitizeWorkspaceRelativePath(root, { fallback: null }) : null;
}

/**
 * Lock the single project root for this conversation job and persist to memory + DB.
 * @param {'scaffold_create'|'resolved_existing'|'inspect'|'conversation_restore'} source
 */
export async function lockProjectRoot(
  threadId,
  projectRoot,
  { source = "unknown", conversation = null } = {},
) {
  const safe = sanitizeWorkspaceRelativePath(projectRoot);
  if (safe == null || safe === "") return null;

  const state = getThreadState(threadId);
  state.lockedProjectRoot = safe;
  state.projectRootSource = source;
  state.workspaceRootLocked = safe === ".";
  state.conversationRootSource =
    source === "conversation_user" ? "user" : state.conversationRootSource ?? "default";
  if (safe !== ".") {
    state.activeProjectRoot = safe;
    state.cwd = safe;
  }

  const { recordProjectHint } = await import("./fileContext.js");
  if (safe !== ".") recordProjectHint(threadId, safe);

  const { getConversation, saveConversation } = await import("./conversations.js");
  const conv =
    conversation ?? (await getConversation(threadId, { createIfMissing: false }));
  if (conv) {
    conv.projectRoot = safe;
    conv.workspaceRootSource =
      source === "conversation_user" ? "user" : conv.workspaceRootSource ?? "default";
    if (safe !== ".") conv.cwd = safe;
    else conv.cwd = conv.cwd ?? ".";
    await saveConversation(conv);
  }

  return safe;
}

export function isWorkspaceRootLocked(threadId) {
  return getThreadState(threadId).workspaceRootLocked === true;
}

export async function restoreLockedProjectRoot(threadId, projectRoot, source = "conversation_restore") {
  if (!projectRoot) return null;
  return lockProjectRoot(threadId, projectRoot, { source });
}

export function getWorkspaceInventory(threadId) {
  return getThreadState(threadId).workspaceInventory ?? null;
}

export function getThreadCwd(threadId) {
  return getThreadCwdFromMemory(threadId);
}

export async function setThreadCwd(threadId, relativePath) {
  const safe = sanitizeWorkspaceRelativePath(relativePath);
  resolveSafePath(safe);
  setThreadCwdInMemory(threadId, safe);
  await syncActiveProjectRoot(threadId, safe);

  try {
    const { setConversationCwd } = await import("./conversations.js");
    await setConversationCwd(threadId, safe);
  } catch {
    // conversation store may not be loaded yet during startup
  }
}

export async function setActiveProjectRoot(threadId, projectRoot) {
  if (!projectRoot) {
    setActiveProjectRootInMemory(threadId, null);
    return;
  }
  const safe = sanitizeWorkspaceRelativePath(projectRoot);
  resolveSafePath(safe);
  setActiveProjectRootInMemory(threadId, safe);
}

export async function initializeThreadWorkspace(
  threadId,
  {
    cwd,
    userMessage,
    turnProfile = "code",
    conversation = null,
    mentionedProjects = [],
    skipHeavyInit = false,
  } = {},
) {
  let safeCwd = sanitizeWorkspaceRelativePath(cwd ?? ".");

  if (skipHeavyInit) {
    setThreadCwdInMemory(threadId, safeCwd);
    return safeCwd;
  }

  const state = getThreadState(threadId);
  state.scaffoldNote = null;
  state.projectResolution = null;

  const userConversationRoot =
    conversation && (await import("./conversationWorkspace.js")).isUserDefinedConversationRoot(conversation);

  if (conversation) {
    const { applyConversationWorkspaceToThread, getConversationWorkspaceRoot } =
      await import("./conversationWorkspace.js");
    await applyConversationWorkspaceToThread(threadId, conversation);
    safeCwd = getConversationWorkspaceRoot(conversation);
  }

  const hint = extractProjectPathFromMessage(userMessage);
  const isScaffold = userMessage && isNewScaffoldTask(userMessage);
  const shouldResolve =
    Boolean(userMessage) &&
    turnProfile !== "chat" &&
    (isScaffold ||
      turnProfile === "code" ||
      turnProfile === "explore" ||
      /\b(fix|add|update|implement|refactor|debug|inspect|todo|vue|react|app|project)\b/i.test(
        String(userMessage),
      ));

  if (shouldResolve) {
    const resolution = await resolveProjectContext({
      message: userMessage,
      cwd: safeCwd,
      explicitPath: hint,
      turnProfile,
      conversation,
      mentionedProjects,
    });

    state.projectResolution = resolution;
    state.scaffoldNote = resolution.reason;
    state.workspaceInventory = resolution.inventory;

    const workspaceLocked = isWorkspaceRootLocked(threadId) || userConversationRoot;

    if (resolution.action === "use_existing" && resolution.activeProject) {
      if (workspaceLocked || userConversationRoot) {
        const { getConversationWorkspaceRoot } = await import("./conversationWorkspace.js");
        safeCwd = getConversationWorkspaceRoot(conversation) ?? safeCwd;
        setActiveProjectRootInMemory(threadId, resolution.activeProject);
        const { recordProjectHint } = await import("./fileContext.js");
        recordProjectHint(threadId, resolution.activeProject);
      } else {
        safeCwd = resolution.cwd ?? resolution.activeProject;
        await lockProjectRoot(threadId, resolution.activeProject, {
          source: "resolved_existing",
          conversation,
        });
      }
    } else if (resolution.action === "workspace_view") {
      safeCwd = resolution.cwd ?? safeCwd;
    }
  } else {
    const { scanWorkspaceProjects } = await import("./workspaceProjects.js");
    state.workspaceInventory = await scanWorkspaceProjects();
  }

  setThreadCwdInMemory(threadId, safeCwd);
  await syncActiveProjectRoot(threadId, safeCwd);

  const detected = await detectProjectRoot(safeCwd);
  if (detected.projectRoot) {
    setActiveProjectRootInMemory(threadId, detected.projectRoot);
  }

  return safeCwd;
}

export async function updateCwdFromTool(threadId, toolName, args = {}) {
  if (toolName === "list_directory") {
    await setThreadCwd(
      threadId,
      sanitizeWorkspaceRelativePath(args.path || "."),
    );
    return;
  }

  if (toolName === "inspect_codebase") {
    const locked = getLockedProjectRoot(threadId);
    const start = sanitizeWorkspaceRelativePath(
      locked ?? args.path ?? getThreadCwd(threadId),
    );
    await syncActiveProjectRoot(threadId, start);
    const detected = await detectProjectRoot(start);
    const root = detected.projectRoot ?? (start !== "." ? start : null);
    if (root && !locked) {
      await lockProjectRoot(threadId, root, { source: "inspect" });
    }
    return;
  }

  if (toolName === "read_file" || toolName === "write_file") {
    return;
  }

  if (toolName === "run_bash" && args.command) {
    const locked = getLockedProjectRoot(threadId);
    if (locked) {
      // Do not re-root the job when mkdir/cd runs inside the locked project
      return;
    }

    const mkdirMatch = args.command.match(
      /(?:^|&&\s*|;)\s*mkdir\s+(?:-p\s+)?([^\s&;]+)/,
    );
    if (mkdirMatch) {
      const next = joinWorkspacePath(getThreadCwd(threadId), mkdirMatch[1]);
      await setThreadCwd(threadId, next);
      setActiveProjectRootInMemory(threadId, next);
    }

    const cdMatch = args.command.match(
      /(?:^|&&\s*|;)\s*cd\s+([^\s&;]+)/,
    );
    if (cdMatch) {
      const next = joinWorkspacePath(getThreadCwd(threadId), cdMatch[1]);
      await setThreadCwd(threadId, next);
    } else if (args.cwd) {
      const safeCwd = sanitizeWorkspaceRelativePath(args.cwd);
      await syncActiveProjectRoot(threadId, safeCwd);
      const detected = await detectProjectRoot(safeCwd);
      if (detected.projectRoot) {
        setActiveProjectRootInMemory(threadId, detected.projectRoot);
      }
    }
  }
}

/**
 * Load cwd from the conversation record and reset in-memory thread workspace.
 * Use at API boundaries so stale/corrupt thread state cannot persist.
 */
export async function ensureThreadWorkspace(threadId) {
  const { getConversation, saveConversation } = await import("./conversations.js");
  const conversation = await getConversation(threadId, { createIfMissing: false });

  if (conversation?.projectRoot) {
    await restoreLockedProjectRoot(threadId, conversation.projectRoot);
  }

  const raw = conversation?.cwd ?? getThreadCwdFromMemory(threadId);
  const safe = sanitizeWorkspaceRelativePath(raw);

  setThreadCwdInMemory(threadId, safe);
  await syncActiveProjectRoot(threadId, safe);

  if (conversation && safe !== conversation.cwd) {
    conversation.cwd = safe;
    await saveConversation(conversation);
  }

  return safe;
}

export async function listWorkspace(relativePath = ".") {
  const safePath = sanitizeWorkspaceRelativePath(relativePath);

  try {
    return await listWorkspaceAt(safePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (safePath === ".") throw error;
    return await listWorkspaceAt(".");
  }
}

async function listWorkspaceAt(safePath) {
  const fullPath = resolveSafePath(safePath);
  const entries = await fs.readdir(fullPath, { withFileTypes: true });

  const items = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(fullPath, entry.name);
      const relPath = path.relative(config.workspaceDir, entryPath).replace(/\\/g, "/");
      const item = {
        name: entry.name,
        path: relPath,
        type: entry.isDirectory() ? "dir" : "file",
      };

      if (entry.isFile()) {
        const stat = await fs.stat(entryPath);
        item.size = stat.size;
      }

      return item;
    }),
  );

  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    workspace: config.workspaceDir,
    path: safePath,
    entries: items,
  };
}

export function getWorkspaceSnapshot(threadId, viewPath) {
  const cwd = getThreadCwd(threadId);
  return {
    workspace: config.workspaceDir,
    cwd,
    viewPath: viewPath ? sanitizeWorkspaceRelativePath(viewPath) : cwd,
    activeProjectRoot: getActiveProjectRoot(threadId),
    lockedProjectRoot: getLockedProjectRoot(threadId),
  };
}
