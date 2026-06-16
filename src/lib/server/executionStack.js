import { isCodingTask, isSimpleFilesystemTask } from "./codingResearch.js";
import { isUiTask } from "./uiDesignGuidance.js";
import {
  isKnowledgeQuestion,
  hasCodebaseLookupIntent,
  requiresAgentTaskPlan,
} from "./knowledgeQA.js";
import { isExplicitToolRunbook } from "./workspacePreflight.js";

export const STACK_PHASES = [
  { id: "research", label: "Research web", icon: "search" },
  { id: "awareness", label: "Check workspace", icon: "folder" },
  { id: "explore", label: "Explore codebase", icon: "folder" },
  { id: "grep", label: "Search code", icon: "grep" },
  { id: "think", label: "Thinking", icon: "think" },
  { id: "plan", label: "Task plan", icon: "plan" },
  { id: "execute", label: "Execute changes", icon: "execute" },
  { id: "verify", label: "Verify", icon: "verify" },
];

export const STACK_PROFILES = {
  chat: {
    label: "Quick reply",
    phases: ["think"],
  },
  research: {
    label: "Research",
    phases: ["think", "research"],
  },
  explore: {
    label: "Explore codebase",
    phases: ["think", "explore", "grep"],
  },
  code: {
    label: "Full coding workflow",
    // "plan" omitted — appears only when update_task_plan runs (not inter-tool next-move planning)
    phases: ["research", "awareness", "explore", "grep", "think", "execute", "verify"],
  },
  tools: {
    label: "Direct tool runbook",
    phases: ["think", "execute", "verify"],
  },
};

const CASUAL_REPLY =
  /^(that'?s?\s+(cool|great|good|nice|awesome|perfect|fine|helpful|amazing)|thanks?(?:\s+you)?|thank you|thx|ok(?:ay)?|got it|nice|cool|perfect|awesome|lol|haha|sure|yep|yeah|yes|no|sounds good|looks good|works for me|will do|understood|noted|appreciate it|good to know|makes sense|i see|fair enough)[!.?\s]*$/i;

const EXPLORE_PATTERNS = [
  /\b(where|find|search|semantic|grep|locate|show me|explain|how does|what does|which file|look up|look at)\b/i,
  /\b(read|inspect|codebase|project structure)\b/i,
];

const RESEARCH_PATTERNS = [
  /\b(latest|current|news|what is|who is|how to|best practice|documentation|breaking change)\b/i,
  /\bwhat'?s?\s+new\b/i,
  /\b(release notes|changelog|what changed)\b/i,
  /\b20\d{2}\b/,
];

const stacks = new Map();
const stackProfiles = new Map();

const TOOL_TO_PHASE = {
  web_search: "research",
  search_files: "explore",
  inspect_codebase: "explore",
  detect_stack: "explore",
  inspect_ast: "explore",
  list_directory: "explore",
  grep_code: "grep",
  glob_files: "grep",
  semantic_search: "grep",
  update_task_plan: "plan",
  mark_plan_step: "plan",
  read_file: "execute",
  write_file: "execute",
  search_replace: "execute",
  run_bash: "execute",
  apply_template: "execute",
  verify_project: "verify",
  check_syntax: "verify",
  read_lints: "verify",
  run_check: "verify",
  delete_file: "execute",
  read_files: "execute",
};

/**
 * Heuristic turn profile — only phases listed here appear in the UI.
 * Nothing runs unless the agent actually calls tools for that phase.
 */
export function classifyExecutionProfile(message) {
  const text = String(message ?? "").trim();
  if (!text) return "chat";

  if (CASUAL_REPLY.test(text)) return "chat";

  if (isExplicitToolRunbook(text)) return "tools";

  if (isSimpleFilesystemTask(text)) return "tools";

  if (hasCodebaseLookupIntent(text)) return "explore";

  if (isCodingTask(text)) return "code";

  if (EXPLORE_PATTERNS.some((p) => p.test(text))) return "explore";

  if (RESEARCH_PATTERNS.some((p) => p.test(text))) return "research";

  if (
    text.length < 48 &&
    !/\b(search|find|fix|implement|code|file|grep|verify|tool|semantic)\b/i.test(text)
  ) {
    return "chat";
  }

  return "chat";
}

function phaseTemplate(phaseId) {
  return STACK_PHASES.find((p) => p.id === phaseId);
}

function buildStackFromPhaseIds(phaseIds) {
  return phaseIds
    .map((id) => phaseTemplate(id))
    .filter(Boolean)
    .map((p) => ({
      ...p,
      status: "pending",
      detail: "",
      at: null,
    }));
}

function getStack(threadId) {
  return stacks.get(threadId) ?? null;
}

function ensurePhase(threadId, phaseId) {
  let stack = getStack(threadId);
  if (!stack) {
    stack = initExecutionStack(threadId, "chat");
  }
  if (findPhase(stack, phaseId)) return stack;

  const template = phaseTemplate(phaseId);
  if (!template) return stack;

  const insertAt = STACK_PHASES.findIndex((p) => p.id === phaseId);
  const newPhase = { ...template, status: "pending", detail: "", at: null };

  let placed = false;
  for (let i = 0; i < stack.length; i++) {
    const existingIdx = STACK_PHASES.findIndex((p) => p.id === stack[i].id);
    if (insertAt < existingIdx) {
      stack.splice(i, 0, newPhase);
      placed = true;
      break;
    }
  }
  if (!placed) stack.push(newPhase);

  return stack;
}

export function initExecutionStack(threadId, profile = "chat") {
  const config = STACK_PROFILES[profile] ?? STACK_PROFILES.chat;
  stacks.set(threadId, buildStackFromPhaseIds(config.phases));
  stackProfiles.set(threadId, profile);
  return stacks.get(threadId);
}

export function getExecutionStackProfile(threadId) {
  return stackProfiles.get(threadId) ?? "chat";
}

/** UI/coding work needs the full stack even when the turn also mentions web search. */
export function resolveExecutionStackProfile(turnProfile, message) {
  if (isKnowledgeQuestion(message)) {
    return turnProfile === "research" ? "research" : "chat";
  }
  if (turnProfile === "tools") return "tools";
  if (turnProfile === "explore") return "explore";
  const text = String(message ?? "");
  if (isExplicitToolRunbook(text)) return "tools";
  if (isSimpleFilesystemTask(text)) return "tools";
  if (hasCodebaseLookupIntent(text)) return "explore";
  if (!requiresAgentTaskPlan(text)) {
    return turnProfile === "research" ? "research" : "explore";
  }
  if (turnProfile === "code") return "code";
  if (isCodingTask(text) || isUiTask(text)) return "code";
  return turnProfile ?? "chat";
}

export function clearExecutionStack(threadId) {
  stacks.delete(threadId);
  stackProfiles.delete(threadId);
}

export function getExecutionStack(threadId) {
  return getStack(threadId);
}

function findPhase(stack, phaseId) {
  return stack.find((p) => p.id === phaseId);
}

export function setStackPhase(threadId, phaseId, status, detail = "") {
  ensurePhase(threadId, phaseId);
  const stack = getStack(threadId);
  const phase = stack ? findPhase(stack, phaseId) : null;
  if (!phase) return stack;

  phase.status = status;
  if (detail) phase.detail = detail;
  phase.at = Date.now();

  if (status === "active") {
    for (const p of stack) {
      if (p.id !== phaseId && p.status === "active") {
        p.status = "done";
      }
    }
  }

  return stack;
}

export function markStackToolStart(threadId, toolName, args = {}) {
  const phaseId = TOOL_TO_PHASE[toolName];
  if (!phaseId) return getExecutionStack(threadId);

  ensurePhase(threadId, phaseId);
  const detail = formatToolDetail(toolName, args);
  return setStackPhase(threadId, phaseId, "active", detail);
}

export function markStackToolDone(threadId, toolName, preview = "") {
  const phaseId = TOOL_TO_PHASE[toolName];
  if (!phaseId) return getExecutionStack(threadId);

  const stack = getStack(threadId);
  const phase = stack ? findPhase(stack, phaseId) : null;
  const detail = preview || phase?.detail || toolName;
  return setStackPhase(threadId, phaseId, "done", detail);
}

export function markStackExploreIndexed(threadId, map) {
  ensurePhase(threadId, "explore");
  const count = map?.fileCount ?? 0;
  const detail =
    count > 0
      ? `${count} file(s) indexed under ${map?.scanRoot === "." ? "workspace" : map.scanRoot}`
      : "workspace indexed";
  return setStackPhase(threadId, "explore", "done", detail);
}

export function markStackAwarenessPreflight(threadId, preflight) {
  ensurePhase(threadId, "awareness");
  const existsCount = preflight?.entries?.filter((e) => e.exists).length ?? 0;
  const detail = preflight?.scaffoldPresent
    ? "scaffold on disk — skip init"
    : preflight?.awarenessPassComplete
      ? `${existsCount} path(s) on disk`
      : "inspect project before plan";
  const status = preflight?.awarenessPassComplete ? "done" : "active";
  return setStackPhase(threadId, "awareness", status, detail);
}

export function markStackThinking(threadId, step, preview = "") {
  ensurePhase(threadId, "think");
  const detail = preview
    ? `Step ${step}: ${preview.slice(0, 120)}${preview.length > 120 ? "…" : ""}`
    : `Step ${step}`;
  return setStackPhase(threadId, "think", "active", detail);
}

export function markStackThinkingDone(threadId) {
  const stack = getStack(threadId);
  const phase = stack ? findPhase(stack, "think") : null;
  if (phase?.status === "active") {
    setStackPhase(threadId, "think", "done", phase.detail);
  }
  return stack;
}

function formatToolDetail(toolName, args) {
  switch (toolName) {
    case "web_search":
      return args.query ? `query: ${args.query}` : "web search";
    case "grep_code":
      return args.pattern
        ? `/${args.pattern}/${args.path ? ` in ${args.path}` : ""}`
        : "grep";
    case "glob_files":
      return args.pattern ? `glob: ${args.pattern}` : "glob";
    case "semantic_search":
      return args.query ? `semantic: ${args.query}` : "semantic search";
    case "search_files":
      return args.query ? `find: ${args.query}` : "search files";
    case "inspect_codebase":
      return args.path ? `from ${args.path}` : "inspect project";
    case "read_file":
    case "write_file":
    case "search_replace":
      return args.path ?? toolName;
    case "run_bash":
      return args.command ? String(args.command).slice(0, 80) : "bash";
    case "update_task_plan":
      return args.title ?? "update plan";
    case "mark_plan_step":
      return args.step_id ? `step ${args.step_id} → ${args.status ?? "done"}` : "mark step";
    case "verify_project":
      return args.path ?? "verify";
    case "check_syntax":
    case "read_lints":
      return args.path ?? "syntax check";
    case "run_check":
      return args.label ?? args.command ?? "check";
    case "delete_file":
    case "read_files":
      return args.path ?? (args.paths ? `${args.paths.length} files` : toolName);
    default:
      return toolName;
  }
}

export function buildStackEvent(threadId, extra = {}) {
  const stack = getStack(threadId);
  if (!stack) return null;
  const profile = getExecutionStackProfile(threadId);
  return {
    type: "stack",
    profile,
    profileLabel: STACK_PROFILES[profile]?.label ?? profile,
    phases: stack.map((p) => ({ ...p })),
    ...extra,
  };
}
