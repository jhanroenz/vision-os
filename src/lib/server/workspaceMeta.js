import path from "node:path";
import { config } from "./config.js";
import { isCodingTask } from "./codingResearch.js";
import {
  getThreadCwd,
  getActiveProjectRoot,
  getLockedProjectRoot,
} from "./workspace.js";

const WORKSPACE_META_PATTERNS = [
  /\b(what(?:'s| is)|where(?:'s| is)|show(?: me)?|tell me|which is)\b.{0,50}\b(workspace|working directory|current directory|cwd|project (?:root|directory|folder)|active project)\b/i,
  /\b(workspace|working directory|current directory|cwd|project root)\b.{0,40}\b(what|where|current|now)\b/i,
  /\b(what|where|current|check|show|verify)\b.{0,30}\b(workspace|working directory|current directory|cwd|project root)\b/i,
  /\bwhat directory\b.{0,30}\b(in|am i|are we|you)\b/i,
  /\bwhere are you\b/i,
  /\bwhere (?:am i|are we)(?:\s+right now)?\b/i,
];

/**
 * Regex fallback for obvious workspace-location phrasing.
 * Authoritative routing uses intent assessment (LLM/heuristic) first — see agent.js.
 */
export function isWorkspaceMetaQuestion(message) {
  const text = String(message ?? "").trim();
  if (!text) return false;
  if (isWorkspaceLockRequest(text)) return false;
  // "scaffold in the current project root" mentions paths but is implementation work.
  if (isCodingTask(text)) return false;
  return WORKSPACE_META_PATTERNS.some((p) => p.test(text));
}

const WORKSPACE_LOCK_PATTERNS = [
  /\block\b.{0,24}\b(?:on|that|this|it|here|cwd|workspace|directory|dir|folder)\b/i,
  /\block\b.{0,12}\b(?:the\s+)?(?:workspace|working directory|current directory|cwd|project root)\b/i,
  /\b(?:lock|pin|fix)\b.{0,20}\b(?:workspace|cwd|directory|dir|folder)\b/i,
  /\b(?:save|set)\b.{0,20}\b(?:cwd|working directory|workspace)\b.{0,20}\block\b/i,
];

/** User wants to lock cwd/workspace for subsequent tool paths — not brain memory. */
export function isWorkspaceLockRequest(message) {
  const text = String(message ?? "").trim();
  if (!text || text.length > 120) return false;
  return WORKSPACE_LOCK_PATTERNS.some((p) => p.test(text));
}

function absoluteWorkspacePath(relativeCwd) {
  const cwd = relativeCwd === "." ? "" : relativeCwd;
  return cwd ? path.join(config.workspaceDir, cwd) : config.workspaceDir;
}

/** Factual path context for all turn profiles — no reply-style rules here. */
export function formatWorkspaceBlock(
  cwd = ".",
  { activeProject = null, lockedProjectRoot = null, conversationWorkspaceBlock = null } = {},
) {
  const abs = absoluteWorkspacePath(cwd);
  const lines = [
    `Workspace root: ${config.workspaceDir}`,
    `Current directory: ${cwd} (absolute: ${abs})`,
  ];
  if (activeProject && activeProject !== cwd) {
    lines.push(`Active project: ${activeProject}`);
  }
  if (lockedProjectRoot) {
    lines.push(`Locked project root: ${lockedProjectRoot}`);
  }
  if (conversationWorkspaceBlock) {
    lines.push(conversationWorkspaceBlock);
  }
  return lines.join("\n");
}

/** Direct reply for explicit workspace meta questions. */
export function formatWorkspaceAnswer(threadId) {
  const cwd = getThreadCwd(threadId);
  const activeProject = getActiveProjectRoot(threadId);
  const lockedProjectRoot = getLockedProjectRoot(threadId);
  const abs = absoluteWorkspacePath(cwd);

  const lines = [
    `Workspace root: \`${config.workspaceDir}\``,
    `Current directory: \`${abs}\`${cwd !== "." ? ` (relative: \`${cwd}\`)` : ""}`,
  ];
  if (activeProject && activeProject !== cwd) {
    lines.push(`Active project: \`${activeProject}\``);
  }
  if (lockedProjectRoot) {
    lines.push(`Locked project root: \`${lockedProjectRoot}\``);
  }
  return lines.join("\n");
}
