import { config } from "./config.js";
import { formatWorkspaceBlock } from "./workspaceMeta.js";
import { sortToolsForPrompt } from "./tools/index.js";
import {
  GEMMA_TOOL_ANCHOR,
  isGemmaSmallModel,
} from "./gemmaToolGuidance.js";

const IDENTITY_BLOCK = `You are Jarvis — Master Jan's local AI assistant on Bazzite Linux.
Address him as "Master Jan." You run locally with workspace and filesystem access.`;

const PARALLEL_TOOLS_HINT = `When several read-only tools are independent (search_files, read_file, read_files, grep_code, inspect_ast, list_directory), return multiple tool_calls in one reply.`;

const PROFILE_SUFFIX = {
  chat: `Mode: casual chat. Plain text is fine. Optional read-only tools when they help.`,
  ask: `Mode: Q&A. Use web_search or recall_brain when needed. No file edits.`,
  research: `Mode: research. web_search once if useful; cite URLs.`,
  explore: `Mode: explore. Read/search codebase; no writes unless Jan switches to Agent mode.`,
  appBuilder: `Mode: App Builder. Scaffold/publish user apps in workspace/apps/ only; register_user_app before done.`,
  code: `Mode: coding agent. Server enforces phases: awareness → plan (update_task_plan) → execute → verify.
Output raw JSON {"tool":"name","args":{...}} for tools — no markdown fences. Plain text only on final handoff after verify passes.
Context for this step is in the [TURN packet] user message — follow it.`,
};

function formatMemoriesCompact(memories, activeProject = null) {
  if (!memories?.length) return "(none)";
  return memories
    .map((m) => {
      const cat = m.category ? `[${m.category}] ` : "";
      const proj =
        m.project && m.project !== activeProject ? `[${m.project}] ` : "";
      return `- ${cat}${proj}${m.title}`;
    })
    .join("\n");
}

function formatSkillsCompact(skills, activeProject = null) {
  if (!skills?.length) return "(none)";
  return skills
    .map((s) => {
      const proj =
        s.project && s.project !== activeProject ? `[${s.project}] ` : "";
      return `- ${proj}${s.name}`;
    })
    .join("\n");
}

function formatFailuresCompact(failures, activeProject = null) {
  if (!failures?.length) return "(none)";
  return failures
    .map((f) => {
      const proj =
        f.project && f.project !== activeProject ? `[${f.project}] ` : "";
      return `- ${proj}${f.promptText}`;
    })
    .join("\n");
}

function compactToolDocs(tools) {
  return sortToolsForPrompt(tools)
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");
}

function jsonToolFooter() {
  return `Tool format: {"tool":"name","args":{...}} — raw JSON only, no markdown fences around JSON.`;
}

/**
 * @param {{ step?: number, lastToolParseFailed?: boolean, profile?: string }} [opts]
 */
export function needsGemmaToolAnchor(opts = {}) {
  if (!isGemmaSmallModel()) return false;
  const profile = opts.profile ?? "code";
  if (profile !== "code") return false;
  if (opts.lastToolParseFailed) return true;
  return (opts.step ?? 0) === 0;
}

/**
 * Compact system prompt — stable across steps for prompt caching.
 */
export function buildCoreSystemPrompt(
  tools,
  {
    profile = "code",
    memories = [],
    skills = [],
    failures = [],
    activeProject = null,
    cwd = ".",
    lockedProjectRoot = null,
    gemmaAnchor = false,
  } = {},
) {
  const suffix = PROFILE_SUFFIX[profile] ?? PROFILE_SUFFIX.code;

  const parts = [
    IDENTITY_BLOCK,
    "",
    `Memory:${formatMemoriesCompact(memories, activeProject)}`,
    `Skills:${formatSkillsCompact(skills, activeProject)}`,
    `Lessons:${formatFailuresCompact(failures, activeProject)}`,
    "Detail: recall_brain({ query }) on demand.",
    "",
    formatWorkspaceBlock(cwd, { activeProject, lockedProjectRoot }),
    "",
    "Tools:",
    compactToolDocs(tools) || "(none)",
    "",
    PARALLEL_TOOLS_HINT,
    jsonToolFooter(),
    "",
    suffix,
  ];

  if (gemmaAnchor) {
    parts.push("", GEMMA_TOOL_ANCHOR);
  }

  return parts.join("\n");
}

export function isPromptCompactMode() {
  if (config.agent?.loopV2) return true;
  return config.prompt?.compactMode !== false;
}
