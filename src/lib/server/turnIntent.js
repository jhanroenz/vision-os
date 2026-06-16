import { config } from "./config.js";
import { usedWebSearch, isInPlaceProjectWork } from "./codingResearch.js";
import { getLockedProjectRoot } from "./workspace.js";
import { classifyUserIntentFallback, buildTurnIntentFromSignals, tryConfidentHeuristicIntent } from "./intentClassifier.js";
import {
  runIntentAssessment,
  buildIntentAssessmentBrief,
  validateAssessmentRaw,
  runFollowUpAssessment,
  applyFollowUpToIntent,
  hasRecentCodingWork,
} from "./intentAssessment.js";

/** Memory / persona tools on light turns. */
export const MEMORY_TOOLS = new Set(["remember", "learn_skill", "recall_brain"]);

/**
 * Read-only workspace + research tools — exposed in Ask/casual; Jarvis decides per turn.
 */
export const READ_ONLY_ANSWER_TOOLS = new Set([
  "web_search",
  "recall_brain",
  "inspect_codebase",
  "detect_stack",
  "inspect_ast",
  "search_files",
  "list_directory",
  "read_file",
  "read_files",
  "grep_code",
  "glob_files",
  "semantic_search",
]);

/** Ask composer mode — answer from memory, web, or local repo (no edits). */
export const ASK_MODE_TOOLS = new Set([...READ_ONLY_ANSWER_TOOLS]);

/** Casual Agent chat — memory tools plus optional read-only answer tools. */
export const CASUAL_CHAT_TOOLS = new Set([
  ...MEMORY_TOOLS,
  ...READ_ONLY_ANSWER_TOOLS,
]);

const activeTurnIntent = new Map();

/**
 * @typedef {{
 *   profile: "chat" | "research" | "explore" | "code",
 *   casualChat: boolean,
 *   askMode?: boolean,
 *   allowWebSearch: boolean,
 *   requireWebResearchFirst: boolean,
 *   followUpProjectWork?: boolean,
 *   workspaceMetaQuestion?: boolean,
 *   saveToMemory?: boolean,
 *   actionSummary?: string,
 *   source: "llm-assessment" | "llm" | "zero-shot" | "default" | "heuristic",
 *   reason?: string,
 * }} TurnIntent
 */

export function setTurnIntent(threadId, intent) {
  activeTurnIntent.set(threadId, intent);
}

export function getTurnIntent(threadId) {
  return activeTurnIntent.get(threadId) ?? null;
}

/** LLM-assessed follow-up on an existing locked project (fix/debug/continue). */
export function isFollowUpProjectTurn(threadId) {
  return getTurnIntent(threadId)?.followUpProjectWork === true;
}

export function clearTurnIntent(threadId) {
  activeTurnIntent.delete(threadId);
}

/** Plain small-talk turn — minimal UI, no workspace/tool noise. */
export function isMinimalChatTurn(threadId) {
  const intent = getTurnIntent(threadId);
  return intent?.casualChat === true || intent?.askMode === true;
}

export function isAskModeTurn(threadId) {
  return getTurnIntent(threadId)?.askMode === true;
}

export function askModeSkipMessage() {
  return (
    "Ask mode — that tool is not available (no file edits, shell, or task execution). " +
    "Use read-only tools (web_search, recall_brain, detect_stack, inspect_codebase, read_file, grep_code, …) " +
    "or reply in plain text. Switch to full Agent mode for write_file, run_bash, and coding."
  );
}

/** Fixed intent when Master Jan selects Ask in the composer. */
export function buildAskComposerTurnIntent() {
  return buildTurnIntentFromSignals({
    profile: "research",
    casualChat: false,
    askMode: true,
    allowWebSearch: true,
    requireWebResearchFirst: false,
    saveToMemory: false,
    source: "composer-ask",
    reason: "Ask mode — read-only answer tools",
    actionSummary:
      "Answer in plain text; use recall_brain, web_search, detect_stack, or repo read tools when helpful",
  });
}

export function webResearchRequiredForTurn(threadId, toolEvents, userMessage = "") {
  const intent = getTurnIntent(threadId);
  if (!intent?.requireWebResearchFirst) return false;
  const lockedRoot = getLockedProjectRoot(threadId);
  if (isInPlaceProjectWork(userMessage, lockedRoot)) return false;
  if (getTurnIntent(threadId)?.followUpProjectWork) return false;
  return !usedWebSearch(toolEvents);
}

export function webSearchSkipMessage(intent) {
  if (intent?.casualChat) {
    return (
      "Web search is not needed for casual chat. " +
      "Reply in plain text — do not call web_search."
    );
  }
  return (
    "Web search failed or is unavailable. " +
    "Continue with other tools or reply in plain text."
  );
}

/** Tools allowed per turn profile (code gets full set). */
export const PROFILE_TOOL_SETS = {
  chat: CASUAL_CHAT_TOOLS,
  research: new Set([...CASUAL_CHAT_TOOLS]),
  explore: new Set([
    ...CASUAL_CHAT_TOOLS,
    "web_search",
    "search_files",
    "inspect_codebase",
    "detect_stack",
    "inspect_ast",
    "list_directory",
    "grep_code",
    "glob_files",
    "semantic_search",
    "read_file",
    "update_task_plan",
    "mark_plan_step",
  ]),
  tools: new Set([
    ...CASUAL_CHAT_TOOLS,
    "run_bash",
    "list_directory",
    "inspect_ast",
    "read_file",
  ]),
};

export function isLiteProfile(intent) {
  return intent?.profile === "chat";
}

export function isCodingProfile(intent) {
  return intent?.profile === "code";
}

export function isExploreProfile(intent) {
  return intent?.profile === "explore";
}

export function casualChatSkipMessage() {
  return (
    "Casual chat — that tool is not available (no edits, shell, or task execution). " +
    "Use optional read-only tools when they help, or reply in plain text."
  );
}

/** @deprecated testing only */
export function buildHeuristicTurnIntent(message) {
  return buildTurnIntentFromSignals({
    profile: "chat",
    casualChat: true,
    allowWebSearch: false,
    requireWebResearchFirst: false,
    source: "default",
    reason: "heuristic removed",
  });
}

/**
 * LLM intent assessment first, then heuristic / zero-shot fallback.
 * When a locked project has prior work, a dedicated follow-up assessment runs too.
 * @param {string} message
 * @param {object} [context]
 */
export async function assessTurnIntent(message, context = {}) {
  const text = String(message ?? "").trim();

  if (!text) {
    return buildTurnIntentFromSignals({
      profile: "chat",
      casualChat: true,
      allowWebSearch: false,
      requireWebResearchFirst: false,
      source: "default",
      reason: "empty message",
    });
  }

  const hasLockedProject =
    context.lockedProjectRoot && context.lockedProjectRoot !== ".";
  const hasPriorWork =
    context.priorPlanComplete === true || hasRecentCodingWork(context.recentMessages);
  const useHeuristicFirst =
    config.agent.intentAssessmentHeuristicFirst !== false &&
    !hasLockedProject &&
    !hasPriorWork;

  let intent = null;

  if (useHeuristicFirst) {
    intent = tryConfidentHeuristicIntent(text);
  }

  if (!intent && config.agent.intentAssessmentLlm && config.agent.intentAssessmentEnabled) {
    try {
      intent = await runIntentAssessment(text, context);
    } catch (error) {
      console.warn("[intentAssessment]", error?.message ?? error);
    }
  }

  if (!intent) {
    intent = await classifyUserIntentFallback(text);
  }

  if (
    hasLockedProject &&
    hasPriorWork &&
    !intent.followUpProjectWork &&
    config.agent.intentAssessmentLlm &&
    config.agent.intentAssessmentEnabled
  ) {
    const followUp = await runFollowUpAssessment(text, context);
    if (followUp?.followUp) {
      intent = applyFollowUpToIntent(intent, text, context, {
        reason: followUp.reason,
      });
    }
  }

  return intent;
}

export async function classifyTurnIntent(message, context = {}) {
  return assessTurnIntent(message, context);
}

export { buildIntentAssessmentBrief, validateAssessmentRaw };
