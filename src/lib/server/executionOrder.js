import {
  isCodingTask,
  usedWebSearch,
  isInPlaceProjectWork,
  TOOLS_ALLOWED_BEFORE_RESEARCH,
  buildPrimaryResearchQuery,
  buildWebSearchEncouragementBrief,
  buildWebSearchRepeatBlockedMessage,
  isSimpleFilesystemTask,
} from "./codingResearch.js";
import { getTurnIntent, isFollowUpProjectTurn } from "./turnIntent.js";
import {
  requiresAgentTaskPlan,
  allowsOptionalTaskPlan,
  shouldRetainTaskPlanForTurn,
} from "./knowledgeQA.js";
import { hasValidPlan, getCurrentPlanStep, planProgressSummary } from "./taskPlan.js";
import { getLockedProjectRoot } from "./workspace.js";
import { EXECUTION_NARRATION_RULES } from "./narrationPolicy.js";
import { GREENFIELD_EXECUTE_NEXT_STEPS } from "./scaffoldGuidance.js";
import { isUiTask, uiTaskPlanHints } from "./uiDesignGuidance.js";
import {
  isBlockedPlanRewrite,
  buildPlanRewriteBlockedMessage,
  buildExecutionCommitBrief,
  isPlanFrozen,
} from "./planFreeze.js";
import {
  isAwarenessComplete,
  isAwarenessSatisfied,
  ensureAwarenessComplete,
  getTurnAwareness,
} from "./workspacePreflight.js";
import { buildFilesystemActionPlanBlock } from "./filesystemAwareness.js";

/** Read-only tools allowed during workspace awareness (before plan/execute). */
export const AWARENESS_TOOLS = new Set([
  "search_files",
  "inspect_ast",
  "inspect_codebase",
  "detect_stack",
  "read_file",
  "list_directory",
  "grep_code",
  "glob_files",
  "semantic_search",
  "recall_brain",
  "remember",
  "learn_skill",
]);

export function isAwarenessTool(toolName) {
  return AWARENESS_TOOLS.has(toolName);
}

/** Tools allowed during the plan phase (after web_search, before execute). */
export const PRE_EXECUTE_TOOLS = new Set([
  "remember",
  "learn_skill",
  "recall_brain",
  "update_task_plan",
]);

export function isNewProjectRequest(message) {
  if (isSimpleFilesystemTask(message)) return false;
  const text = String(message ?? "");
  const hasCreate =
    /\b(create|new|scaffold|initialize|set up|setup|start)\b/i.test(text);
  const hasTarget = /\b(project|app|api|directory|folder|repo)\b/i.test(text);
  return hasCreate && hasTarget;
}

export function shouldSkipPlanHydration(message, threadId = null) {
  if (!shouldRetainTaskPlanForTurn(message, getTurnIntent(threadId) ?? {})) {
    return true;
  }
  if (isNewProjectRequest(message)) return true;
  if (threadId && isFollowUpProjectTurn(threadId)) return true;
  return false;
}

/**
 * @returns {"research" | "awareness" | "plan" | "execute"}
 */
function awarenessPhaseRequired(message, threadId, toolEvents) {
  if (!requiresAgentTaskPlan(message)) return false;
  if (isFollowUpProjectTurn(threadId)) return false;
  return !isAwarenessSatisfied(threadId, toolEvents);
}

function lastSearchFilesWasGreenfield(toolEvents) {
  for (let i = (toolEvents ?? []).length - 1; i >= 0; i--) {
    const event = toolEvents[i];
    if (event.type !== "tool_result" || event.name !== "search_files") continue;
    return /Greenfield confirmed/i.test(String(event.content ?? ""));
  }
  return false;
}

function researchPhaseRequired(message, threadId, toolEvents) {
  const intent = getTurnIntent(threadId);
  if (!intent?.requireWebResearchFirst) return false;
  const lockedRoot = getLockedProjectRoot(threadId);
  if (isInPlaceProjectWork(message, lockedRoot)) return false;
  if (intent.followUpProjectWork) return false;
  return !usedWebSearch(toolEvents);
}

export function getExecutionPhase(message, toolEvents, threadId) {
  const intent = getTurnIntent(threadId);
  if (intent?.profile === "tools" || isSimpleFilesystemTask(message)) {
    return "execute";
  }
  if (intent?.profile === "explore" || allowsOptionalTaskPlan(message)) {
    return "execute";
  }
  if (!requiresAgentTaskPlan(message)) return "execute";
  if (researchPhaseRequired(message, threadId, toolEvents)) return "research";
  ensureAwarenessComplete(threadId, toolEvents);
  if (awarenessPhaseRequired(message, threadId, toolEvents)) return "awareness";
  if (!hasValidPlan(threadId)) return "plan";
  return "execute";
}

/**
 * @returns {{ blocked: boolean, phase?: string, nextTool?: string, message?: string, statusLine?: string }}
 */
export function checkExecutionGate(toolName, { message, toolEvents, threadId }) {
  if (
    (toolName === "update_task_plan" || toolName === "mark_plan_step") &&
    !requiresAgentTaskPlan(message)
  ) {
    const intent = getTurnIntent(threadId);
    if (intent?.profile === "explore" || allowsOptionalTaskPlan(message)) {
      // optional explore checklist — allowed
    } else {
      return {
        blocked: true,
        phase: "chat",
        statusLine: "STATUS: BLOCKED (Q&A — no task plan)",
        message:
          `Blocked ${toolName}: this turn is conceptual Q&A, not workspace implementation.\n` +
          "Do NOT create a task plan or inspect the codebase. Answer in plain text.\n" +
          "Use web_search at most once if you need an external reference, then reply with source URLs cited for any excerpts.",
      };
    }
  }

  const phase = getExecutionPhase(message, toolEvents, threadId);

  if (
    toolName === "web_search" &&
    requiresAgentTaskPlan(message) &&
    usedWebSearch(toolEvents)
  ) {
    return {
      blocked: true,
      phase,
      nextTool: phase === "research" ? null : "inspect_codebase",
      statusLine: "STATUS: BLOCKED (one web search per turn)",
      message: buildWebSearchRepeatBlockedMessage(),
    };
  }

  if (phase === "research" && !TOOLS_ALLOWED_BEFORE_RESEARCH.has(toolName)) {
    const query = buildPrimaryResearchQuery(message, {
      activeProject: getLockedProjectRoot(threadId),
    });
    return {
      blocked: true,
      phase,
      nextTool: "web_search",
      statusLine: "STATUS: BLOCKED (wrong phase — research required)",
      message:
        `Blocked ${toolName}: Phase 0 RESEARCH is required first.\n` +
        `Your local LLM training is stale — search for current conventions before any other tool.\n\n` +
        `NEXT REQUIRED: {"tool":"web_search","args":{"query":"${query}"}}\n` +
        `After web_search succeeds, proceed to Phase 1 AWARENESS (check disk), then Phase 2 PLAN.`,
    };
  }

  if (phase === "awareness" && !AWARENESS_TOOLS.has(toolName)) {
    const greenfield = lastSearchFilesWasGreenfield(toolEvents);
    const preflightGreenfield = getTurnAwareness(threadId)?.preflight?.greenfieldScaffold;
    return {
      blocked: true,
      phase,
      nextTool: greenfield || preflightGreenfield ? "update_task_plan" : "inspect_codebase",
      statusLine: "STATUS: BLOCKED (wrong phase — workspace awareness required)",
      message:
        greenfield || preflightGreenfield
          ? `Blocked ${toolName}: Phase 1 AWARENESS is already satisfied (greenfield — no app files on disk yet).\n\n` +
            `Do not repeat search_files for files you plan to create.\n` +
            `NEXT: ${GREENFIELD_EXECUTE_NEXT_STEPS}`
          : `Blocked ${toolName}: Phase 1 AWARENESS is required before planning or executing.\n` +
            `Check what already exists on disk before changing anything.\n\n` +
            `Honor the server EXISTS/MISSING brief injected at turn start.\n` +
            `Call list_directory, inspect_codebase, or search_files on the project root.\n` +
            `search_files with no matches completes awareness for new apps (greenfield).\n` +
            `search_files before search_replace/delete_file — path must appear in results. write_file may create new files.\n\n` +
            `NEXT: complete awareness with one probe tool — then update_task_plan.`,
    };
  }

  if (phase === "plan" && !PRE_EXECUTE_TOOLS.has(toolName)) {
    return {
      blocked: true,
      phase,
      nextTool: "update_task_plan",
      statusLine: "STATUS: BLOCKED (wrong phase — plan required)",
      message:
        `Blocked ${toolName}: Phase 2 PLAN is required before ${toolName}.\n` +
        `Create a numbered TODO checklist with update_task_plan (≥2 steps, final step = verify).\n` +
        `Each step must satisfy the injected acceptance criteria; skip steps for paths already EXISTS/SKIP.\n\n` +
        `NEXT REQUIRED: {"tool":"update_task_plan","args":{"title":"…","steps":[{"id":"1","label":"…","status":"pending"},…]}}\n` +
        `Only after the plan is created may you use run_bash, write_file, and other execute tools.`,
    };
  }

  if (toolName === "mark_plan_step" && !hasValidPlan(threadId)) {
    return {
      blocked: true,
      phase: "plan",
      nextTool: "update_task_plan",
      statusLine: "STATUS: BLOCKED (no task plan)",
      message:
        `Blocked mark_plan_step: No active task plan.\n` +
        `NEXT REQUIRED: call update_task_plan first with ≥2 steps.`,
    };
  }

  if (isBlockedPlanRewrite(toolName, { message, toolEvents, threadId })) {
    return {
      blocked: true,
      phase: "execute",
      nextTool: null,
      statusLine: "STATUS: BLOCKED (plan frozen — execute locked step)",
      message: buildPlanRewriteBlockedMessage(threadId),
    };
  }

  return { blocked: false };
}

export function buildTurnStartExecutionBrief(message, threadId) {
  const phase = getExecutionPhase(message, [], threadId);
  const locked = getLockedProjectRoot(threadId);
  const followUp = isFollowUpProjectTurn(threadId);
  const lines = [
    "EXECUTION ORDER (server-enforced — tools are blocked if you skip phases):",
    ...(followUp
      ? [
          "  FOLLOW-UP FIX — skip web_search; read entry files and wire the UI",
          "  Phase 1 AWARENESS → skipped (existing project)",
          "  Phase 2 PLAN → short fix checklist already seeded",
          "  Phase 3 EXECUTE → read_file, write_file/search_replace, check_syntax, verify_project",
        ]
      : [
          "  Optional — consider web_search once if training data may be stale (versions, APIs, best practices)",
          "  Phase 1 AWARENESS → honor server EXISTS/MISSING brief; read_file / inspect before edits",
          "  Phase 2 PLAN → update_task_plan with ≥2 steps (last step = verify; skip EXISTS work)",
          "  Phase 3 EXECUTE → follow plan steps: run_bash, write_file, read_file, verify_project",
        ]),
    "",
  ];

  if (phase === "research") {
    const query = buildPrimaryResearchQuery(message, { activeProject: locked });
    lines.push(`YOU ARE IN PHASE 0. Call web_search now before any other tool.`);
    lines.push(`Suggested query: "${query}"`);
  } else if (phase === "awareness") {
    lines.push(
      `YOU ARE IN PHASE 1 AWARENESS. web_search is done (or skipped).`,
    );
    lines.push(
      `Review the server EXISTS/MISSING brief. Use read_file / inspect_codebase on paths you will change.`,
    );
    lines.push(`Do NOT call update_task_plan or run_bash until awareness is complete.`);
  } else if (phase === "plan") {
    lines.push(
      `YOU ARE IN PHASE 2. Awareness is done. Call update_task_plan now before run_bash or file tools.`,
    );
    lines.push(`Plan ONLY non-SKIP rows from the filesystem action plan — mark done steps that are already SKIP.`);
    const actionBlock = buildFilesystemActionPlanBlock(
      getTurnAwareness(threadId)?.preflight?.actions,
    );
    if (actionBlock) lines.push(actionBlock);
  } else {
    const current = getCurrentPlanStep(threadId);
    const progress = planProgressSummary(threadId);
    lines.push(`YOU ARE IN PHASE 3 EXECUTE. Task plan: ${progress ?? "?"}.`);
    if (current) {
      lines.push(`Current step: ${current.id}. ${current.label}`);
    }
    if (isPlanFrozen(threadId)) {
      lines.push("");
      lines.push(buildExecutionCommitBrief(threadId));
    } else {
      lines.push(
        "Complete each plan step in order. Tool results include STATUS: SUCCESS or STATUS: FAIL.",
      );
      lines.push("");
      lines.push(EXECUTION_NARRATION_RULES);
    }
  }

  if (locked) {
    lines.push(`Locked project root: ${locked} — all paths must stay under ${locked}/`);
    lines.push(
      `Use project-relative paths in tools and plans (package.json, src/index.js) — do NOT prefix every path with "${locked}/".`,
    );
  }

  if (isUiTask(message)) {
    lines.push("");
    lines.push("UI TASK — apply UI & frontend quality rules from system prompt:");
    for (const hint of uiTaskPlanHints()) {
      lines.push(`  • ${hint}`);
    }
  }

  const intent = getTurnIntent(threadId);
  if (
    !followUp &&
    !intent?.requireWebResearchFirst &&
    requiresAgentTaskPlan(message) &&
    phase !== "research"
  ) {
    const encouragement = buildWebSearchEncouragementBrief(message, {
      activeProject: locked,
    });
    if (encouragement) {
      lines.push("");
      lines.push(encouragement);
    }
  }

  return lines.join("\n");
}

export function suggestToolName(requested, knownToolNames) {
  if (knownToolNames.has(requested)) return requested;
  const lower = String(requested ?? "").toLowerCase().replace(/_+/g, "_");

  if (lower.includes("task") && lower.includes("plan") && knownToolNames.has("update_task_plan")) {
    return "update_task_plan";
  }
  if (lower.includes("mark") && lower.includes("plan") && knownToolNames.has("mark_plan_step")) {
    return "mark_plan_step";
  }

  let best = null;
  let bestScore = 0;
  for (const name of knownToolNames) {
    const shared = [...name].filter((c, i) => lower[i] === c).length;
    if (shared > bestScore && shared >= Math.min(name.length, lower.length) * 0.5) {
      bestScore = shared;
      best = name;
    }
  }
  return best;
}

export function appendToolStatus(toolName, content) {
  const text = String(content ?? "");
  if (/^STATUS:/m.test(text)) return text;

  if (toolName === "read_file") {
    if (/File not found:/i.test(text)) {
      return `STATUS: INFO (file missing — create with write_file)\n${text}`;
    }
    if (/^---\s+.+\s+---/m.test(text) || /^=== FILE:/m.test(text)) {
      return `STATUS: SUCCESS\n${text}`;
    }
  }
  if (
    toolName === "list_directory" &&
    text.trim() &&
    !/Directory not found:/i.test(text)
  ) {
    return `STATUS: SUCCESS\n${text}`;
  }
  if (toolName === "inspect_codebase" && /Project root:/i.test(text)) {
    return `STATUS: SUCCESS\n${text}`;
  }
  if (toolName === "detect_stack" && /\[Project stack —/i.test(text)) {
    return `STATUS: SUCCESS\n${text}`;
  }
  if (toolName === "inspect_ast" && /RESULT:\s*SUCCESS/i.test(text)) {
    const footer =
      "\n\nIf this answers Jan's question, reply now — do not call read_file to confirm. " +
      "Use read_file for exact source when needed (full file or offset/limit on huge files).";
    const body = /If this answers Jan's question/i.test(text) ? text : `${text}${footer}`;
    return `STATUS: SUCCESS\n${body}`;
  }
  if (
    (toolName === "semantic_search" ||
      toolName === "grep_code" ||
      toolName === "glob_files") &&
    text.trim() &&
    !/^Blocked /i.test(text) &&
    !/^PATH REJECTED/i.test(text)
  ) {
    return `STATUS: SUCCESS\n${text}`;
  }
  if (toolName === "verify_project") {
    if (/OVERALL:\s*PASS/i.test(text)) return `STATUS: SUCCESS\n${text}`;
    if (/OVERALL:\s*FAIL/i.test(text)) return `STATUS: FAIL\n${text}`;
  }
  if (toolName === "run_bash") {
    if (/RESULT:\s*SUCCESS/i.test(text)) return `STATUS: SUCCESS\n${text}`;
    if (/RESULT:\s*FAILED/i.test(text)) return `STATUS: FAIL\n${text}`;
  }
  if (toolName === "run_check" || toolName === "read_lints") {
    if (/RESULT:\s*SUCCESS/i.test(text)) return `STATUS: SUCCESS\n${text}`;
    if (/RESULT:\s*FAILED/i.test(text)) return `STATUS: FAIL\n${text}`;
  }
  if (toolName === "delete_file") {
    if (/RESULT:\s*SUCCESS/i.test(text)) return `STATUS: SUCCESS\n${text}`;
    if (/RESULT:\s*FAILED/i.test(text)) return `STATUS: FAIL\n${text}`;
  }
  if (toolName === "read_files" || toolName === "search_files") {
    if (/RESULT:\s*SUCCESS/i.test(text)) return `STATUS: SUCCESS\n${text}`;
    if (/RESULT:\s*FAILED/i.test(text)) return `STATUS: FAIL\n${text}`;
  }
  if (
    (toolName === "write_file" || toolName === "search_replace") &&
    /Wrote|written|replaced|bytes/i.test(text)
  ) {
    return `STATUS: SUCCESS\n${text}`;
  }
  if (toolName === "update_task_plan" && /Task plan (created|updated)/i.test(text)) {
    return `STATUS: SUCCESS\n${text}`;
  }
  if (toolName === "mark_plan_step") {
    if (/No active task plan/i.test(text)) return `STATUS: FAIL\n${text}`;
    if (/Blocked mark_plan_step/i.test(text)) {
      return (
        `STATUS: FAIL\n${text}\n\n` +
        "Complete the step with a tool first — do not repeat mark_plan_step without new evidence."
      );
    }
    if (/Step .+ →/i.test(text)) return `STATUS: SUCCESS\n${text}`;
  }
  if (toolName === "web_search" && text && !/^Web search (failed|limit|query cannot)/i.test(text)) {
    return `STATUS: SUCCESS\n${text}`;
  }
  if (toolName === "recall_brain" && text && !/^Query is empty/i.test(text)) {
    return `STATUS: SUCCESS\n${text}`;
  }
  if (/^Blocked /i.test(text) || /^PATH REJECTED/i.test(text)) {
    return `STATUS: BLOCKED\n${text}`;
  }
  if (/^TOOL DID NOT RUN:/i.test(text)) {
    return `STATUS: FAIL\n${text}`;
  }

  return text;
}
