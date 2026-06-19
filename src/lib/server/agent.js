import {
  activateConversation,
  getActiveSlotId,
  streamChatCompletion,
} from "./slots.js";
import { config } from "./config.js";
import { createTools } from "./tools/index.js";
import { parseToolCallsFromContent, shouldSuppressGemmaToolCallStream } from "./toolParser.js";
import {
  parseReactToolCall,
  sanitizeToolArgs,
  describeToolSchema,
  inferRunBashCommand,
  unwrapNestedToolRequest,
} from "./toolArgs.js";
import { normalizeUpdateTaskPlanArgs } from "./taskPlanNormalize.js";
import {
  getConversation,
  saveConversation,
  addUiMessage,
  resolveLlmMessages,
  getConversationCwd,
} from "./conversations.js";
import { getConversationContext } from "./context.js";
import { minifyLlmMessage, minifyToolResult } from "./minify.js";
import { maybeAutoCompact } from "./memory.js";
import { runCommandMode } from "./directCommands.js";
import {
  isShellWaiting,
  streamShellSession,
  continueShellSession,
  finalizeShellSession,
  getShellSession,
} from "./shellSession.js";
import {
  getThreadCwd,
  getActiveProjectRoot,
  getLockedProjectRoot,
  updateCwdFromTool,
  listWorkspace,
  initializeThreadWorkspace,
  restoreLockedProjectRoot,
  setThreadCwdInMemory,
} from "./workspace.js";
import {
  isWorkspaceMetaQuestion,
  isWorkspaceLockRequest,
  formatWorkspaceAnswer,
} from "./workspaceMeta.js";
import {
  enforceProjectPath,
  defaultScopedPath,
} from "./projectRootLock.js";
import { maybeAutoReflect } from "./evolution.js";
import { resolveCodebasePath, resolveWriteCodebasePath, resolveBashCwd } from "./codebase/pathResolver.js";
import { enrichWriteFileResult } from "./codebase/context.js";
import {
  clearTaskPlan,
  getTaskPlan,
  hasValidPlan,
  syncPlanStep,
  isPlanComplete,
  getIncompleteSteps,
  planStatusBlock,
  hydrateTaskPlanFromDisk,
  reopenStaleCompletedPlan,
  seedFollowUpFixPlan,
  emitPlanEvent,
  planStepHint,
  serializeTaskPlan,
  inferMarkPlanStepDefaults,
  getCurrentPlanStep,
} from "./taskPlan.js";
import {
  assessCompletionReadiness,
  hasReadBackAfterWrites,
  getWrittenPaths,
  getLastVerifyResult,
  extractVerificationErrors,
  hadSuccessfulTool,
  shouldSkipPostWriteVerification,
  syncThreadVerifyFromToolResult,
} from "./verification.js";
import {
  detectAstReadRedirect,
  buildReadFileGateMessage,
} from "./astReadGate.js";
import {
  analyzeBashCommand,
  formatInteractiveBlockMessage,
} from "./nonInteractiveScaffold.js";
import {
  buildWebResearchRetryMessage,
  usedWebSearch,
  buildWebSearchTrainingFallbackBrief,
  buildFixFollowUpBrief,
} from "./codingResearch.js";
import { beginWebSearchTurn } from "./webSearchPolicy.js";
import { resolveWebSearchEngines } from "./searxngEngines.js";
import {
  runNextMovePlanningPhase,
  shouldRunNextMovePlanning,
  formatNextMovePlanInjection,
} from "./nextMovePlanning.js";
import {
  runVerificationPlanningPhase,
  shouldRunVerificationPlanning,
  formatVerificationPlanInjection,
  clearVerificationChecklist,
} from "./verificationPlan.js";
import {
  clearAcceptanceCriteria,
  formatAcceptanceCriteriaInjection,
  shouldSynthesizeAcceptanceCriteria,
  runAcceptanceCriteriaSynthesis,
  applyDeterministicAcceptanceCriteria,
  hasAcceptanceCriteria,
} from "./acceptanceCriteria.js";
import {
  clearHandoffBriefState,
  shouldInjectHandoffBrief,
  buildHandoffBrief,
  markHandoffBriefInjected,
} from "./handoffBrief.js";
import {
  buildExecutionCommitBrief,
  isPlanFrozen,
  syncPlanFreezeAfterTool,
} from "./planFreeze.js";
import {
  runWorkspacePreflight,
  buildWorkspaceAwarenessBrief,
  beginTurnAwareness,
  clearTurnAwareness,
  completeTurnAwareness,
  ensureAwarenessComplete,
  isAwarenessSatisfied,
  getTurnAwareness,
  isExplicitToolRunbook,
  buildExplicitToolRunbookBrief,
  refreshAwarenessEntry,
} from "./workspacePreflight.js";
import {
  buildUpdateTaskPlanSchemaError,
  buildUpdateTaskPlanLoopNudge,
  buildRepeatedSearchFilesNudge,
  claimedHandoffWithUnwrittenFiles,
  buildHandoffIncompleteNudge,
  GREENFIELD_NO_ROOT_LOCK_HINT,
  isPrematureHandoffReply,
  buildExecuteLockedStepNudge,
  buildMarkPlanStepHardCapNudge,
  shouldBlockGreenfieldRootWrite,
  buildGreenfieldRootWriteBlockedMessage,
} from "./scaffoldGuidance.js";
import {
  buildAgentStepContextBrief,
  clearAgentStepContextBrief,
} from "./agentStepContext.js";
import {
  buildWebSearchCitationNudge,
  getWebSearchSourcesFromEvents,
  shouldForceWebSearchCitations,
} from "./webSearchCitations.js";
import {
  shouldForceWebSearchFollowUp,
  buildWebSearchFollowUpNudge,
  webSearchResultsWereUseful,
  isWebSearchLimitReached,
} from "./webSearchAnswer.js";
import {
  preflightBrainForQuestion,
  setBrainSearchPreflight,
  buildBrainPreflightBrief,
  clearBrainWebSearchState,
  autoSaveWebSearchToBrain,
  isWebResearchQuestion,
  setTurnResearchQuestion,
  shouldForceWebSearchAfterEmptyRecall,
  usedRecallBrain,
} from "./webSearchMemory.js";
import { hasSearchIntent } from "./webSearchEligibility.js";
import {
  checkExecutionGate,
  buildTurnStartExecutionBrief,
  suggestToolName,
  appendToolStatus,
  shouldSkipPlanHydration,
  getExecutionPhase,
  isAwarenessTool,
} from "./executionOrder.js";
import {
  checkFilesystemAwarenessGate,
  extractMkdirPathsFromCommand,
} from "./filesystemAwareness.js";
import * as transcriptLog from "./transcriptLog.js";
import { normalizeBashCommandForLockedRoot } from "./bashPathNormalize.js";
import {
  checkPlanStepDoneGate,
  buildStalePlanReopenBrief,
  buildPlanStepLoopRecoveryBrief,
  userIndicatesStalePlan,
} from "./planStepGates.js";
import {
  shouldSuppressStreamNarration,
  shouldSuppressStreamReasoning,
} from "./narrationPolicy.js";
import { deleteExecutionPlan } from "./executionPlan.js";
import { recordAction, clearActions } from "./actionTracker.js";
import {
  assessTurnIntent,
  buildIntentAssessmentBrief,
  buildAskComposerTurnIntent,
  buildAppBuilderComposerTurnIntent,
  setTurnIntent,
  getTurnIntent,
  isFollowUpProjectTurn,
  webResearchRequiredForTurn,
  webSearchSkipMessage,
  casualChatSkipMessage,
  askModeSkipMessage,
  isAskModeTurn,
  ASK_MODE_TOOLS,
  CASUAL_CHAT_TOOLS,
  isMinimalChatTurn,
  isCodingProfile,
  isLiteProfile,
} from "./turnIntent.js";
import { buildIntentAssessmentContext } from "./intentAssessment.js";
import {
  normalizeComposerMode,
  isAskComposerMode,
  isAppBuilderComposerMode,
} from "./composerMode.js";
import { isCursorProvider } from "./llmProviders.js";
import { streamCursorAgentTurn } from "./cursorAgent.js";
import { buildFileChangePayload } from "./diff.js";
import { recordFileChange } from "./changeLog.js";
import { buildFileOpenPreview, readWorkspaceFile } from "./files.js";
import {
  parseCommandToolResult,
  COMMAND_RESULT_TOOLS,
} from "./commandToolResult.js";
import { detectLanguage } from "./fileMeta.js";
import {
  recordFileAccess,
  recordDirectoryListing,
  recordInspectResult,
  recordProjectHint,
  validateWritePath,
  validateReadPath,
  buildFileContextBlock,
  formatReadFileHeader,
  clearFileContext,
  getKnownPaths,
  getFileContextState,
  hasPathWarningsInResults,
  hasUnresolvedPathWarnings,
} from "./fileContext.js";
import {
  initExecutionStack,
  resolveExecutionStackProfile,
  clearExecutionStack,
  markStackToolStart,
  markStackToolDone,
  markStackThinking,
  markStackThinkingDone,
  getExecutionStackProfile,
  buildStackEvent,
  markStackAwarenessPreflight,
  markStackExploreIndexed,
} from "./executionStack.js";
import {
  ensureWorkspaceFileMap,
  formatWorkspaceFileMapBrief,
} from "./workspaceFileMap.js";
import { searchResultCoversPath } from "./filePathSearch.js";
import {
  extractToolRequests,
  groupToolRequests,
  mapWithConcurrency,
} from "./toolParallel.js";
import {
  pruneStaleBriefs,
  pushTurnPacket,
} from "./briefLifecycle.js";
import {
  buildTurnPacket,
  initTurnContext,
  clearTurnContext,
  patchTurnContext,
} from "./turnPacket.js";
import { ensureContextBudget } from "./contextBudget.js";

const MAX_AGENT_STEPS = 50;

function* yieldStack(threadId) {
  if (getExecutionStackProfile(threadId) === "chat") return;
  const event = buildStackEvent(threadId);
  if (event) yield event;
}

const UNCERTAIN_REPLY_PATTERNS = [
  /I (?:do not|don't) have (?:specific |enough )?information/i,
  /I (?:do not|don't) have access to (?:current|recent|live|up-to-date)/i,
  /I am not able to provide (?:specific|current|recent)/i,
  /I cannot provide (?:specific|current|recent|up-to-date)/i,
  /I (?:do not|don't) have the specific/i,
  /I apologize,? but I (?:do not|don't) have/i,
  /(?:unable|cannot) to provide (?:you with|the|specific|current)/i,
  /(?:unable|cannot) to perform (?:live )?web search/i,
  /(?:unable|cannot) to (?:tell you|provide)/i,
  /my (?:training )?knowledge (?:cutoff|may be|is limited)/i,
  /I (?:do not|don't) have (?:real-time|live|current) (?:data|information)/i,
  /as an ai,? I (?:do not|don't) have/i,
  /memory (?:indicates|confirms) that I (?:do not|don't) have/i,
  /(?:unable|cannot) to retrieve/i,
  /I am still unable to/i,
  /cannot answer your question at this moment/i,
  /(?:must|have to) inform you that I (?:cannot|can't)/i,
  /without (?:performing|doing) (?:a )?(?:live )?web search/i,
];

const FACTUAL_QUESTION_PATTERNS = [
  /\b(what|who|when|where|why|how)\b/i,
  /\b(latest|current|today|recent|news|price|weather|release)\b/i,
  /\b(search|look up|find out)\b/i,
  /\b20\d{2}\b/,
];

const BRAIN_SAVE_PATTERNS = [
  /\bsave\b.*\b(brain|memory|core memory)\b/i,
  /\b(brain|memory|core memory)\b.*\bsave\b/i,
  /\bstore\b.*\b(brain|memory|core memory)\b/i,
  /\bsave\s+(it|this|them|that|the results?)\s+to\s+(your\s+)?(brain|memory)\b/i,
  /\bremember\s+(this|it|them|that|these details?)\b/i,
];

import {
  requiresAgentTaskPlan,
  shouldRetainTaskPlanForTurn,
} from "./knowledgeQA.js";

const ERROR_REPORT_PATTERNS = [
  /\berror\b/i,
  /\bfailed\b/i,
  /\bexit code\b/i,
  /\[plugin:[^\]]+\]/i,
  /\b(SyntaxError|TypeError|ReferenceError|RolldownError|ENOENT|EADDRINUSE)\b/,
  /Element is missing end tag/i,
  /at createCompilerError/i,
  /node_modules\/@vue\//i,
  /\.vue:\d+/i,
];

const AGENT_GIVE_UP_PATTERNS = [
  /exhausted the ability/i,
  /exhausted the ability to/i,
  /deeper environmental issue/i,
  /execution environment/i,
  /Final Conclusion/i,
  /cannot reliably determine/i,
  /programmatically fix/i,
  /without direct access/i,
  /cannot directly interact/i,
];

const CODE_DENIAL_PATTERNS = [
  /syntactically correct/i,
  /structure is.*correct/i,
  /code is fine/i,
  /not with the code itself/i,
  /issue is not with the code/i,
  /likely being triggered by the .* (plugin|toolchain|linter)/i,
  /overly sensitive/i,
];

const MANUAL_STEP_PATTERNS = [
  /\bplease (?:run|execute|proceed with)\b/i,
  /\bin your terminal\b/i,
  /\b(yourself|manually)\b/i,
  /\bWould you like me to execute\b/i,
];

const FALSE_PROJECT_CLAIM_PATTERNS = [
  /\b(has been successfully (?:written|created|scaffolded|installed|updated|fixed))\b/i,
  /\b(process has been initiated)\b/i,
  /\b(please proceed with these steps)\b/i,
  /\b(run npm install|npm run dev)\b.*\b(manually|your terminal|yourself)\b/i,
];

const FALSE_SAVE_CLAIM_PATTERNS = [
  /\bsaved (?:the|this|it|search results?|your details?) to (?:my )?memory\b/i,
  /\bhave saved\b.*\b(?:memory|brain)\b/i,
  /\bsaved to (?:my )?(?:brain|core memory)\b/i,
  /\bstored (?:this|it|them) in (?:my )?memory\b/i,
];

function countToolCallsWithArgs(toolEvents, toolName, argsKey, argsValue) {
  const norm = String(argsValue ?? "").trim();
  return toolEvents.filter(
    (e) =>
      e.type === "tool_call" &&
      e.name === toolName &&
      String(e.args?.[argsKey] ?? "").trim() === norm,
  ).length;
}

function claimedWriteWithoutTool(toolEvents, reply, reasoning = "") {
  const text = `${reply}\n${reasoning}`;
  if (!/\b(?:Wrote|written)\b/i.test(text)) return false;
  if (!/\.(?:html|css|js|tsx?|vue)\b/i.test(text)) return false;
  return !hadSuccessfulTool(toolEvents, "write_file");
}

function isEchoingInjectedBrief(reply) {
  const text = String(reply ?? "").trim();
  return (
    /^\[EXECUTION LOCK/m.test(text) ||
    /^\[Hand off summary\]/m.test(text) ||
    /NOW EXECUTING \(locked\)/m.test(text)
  );
}

/** Hard-fail body for tools that were blocked before execution. */
function formatHardBlockedToolResult(toolName, { title, why, next }) {
  const body = [
    `TOOL DID NOT RUN: ${title}`,
    "",
    `WHY: ${why}`,
    `NEXT: ${next}`,
    "",
    "Reasoning or UI narration does not create files — only STATUS: SUCCESS on a real tool result counts.",
  ].join("\n");
  return appendToolStatus(toolName, body);
}

function buildToolResultSummary(statusContent, args = {}) {
  const text = String(statusContent ?? "");
  const success = /^STATUS: SUCCESS/m.test(text);
  const failed = /^STATUS: (FAIL|BLOCKED)/m.test(text);
  if (!success && !failed) return null;
  return {
    success: success && !failed,
    ...(args.path ? { path: args.path } : {}),
  };
}

function attachResultSummary(resultEvent, statusContent, args = {}) {
  if (resultEvent.resultSummary != null) return resultEvent;
  const summary = buildToolResultSummary(statusContent, args);
  if (summary) resultEvent.resultSummary = summary;
  return resultEvent;
}

function refreshSystemMessage(conversation, tools) {
  const cwd = getConversationCwd(conversation.id);
  const systemIndex = conversation.llmMessages.findIndex(
    (m) => m.role === "system" || m.content === "__SYSTEM__",
  );

  const systemMsg = { role: "system", content: "__SYSTEM__", _cwd: cwd };

  if (systemIndex >= 0) {
    conversation.llmMessages[systemIndex] = systemMsg;
  } else {
    conversation.llmMessages.unshift(systemMsg);
  }

  conversation.cwd = cwd;
}

async function resolveToolArgs(toolName, args, threadId, userMessage = "") {
  // Pre-coerce string args BEFORE spreading — spreading a string produces char-index keys
  // and destroys the actual value (e.g. "mkdir foo" → {'0':'m','1':'k',...}).
  let effectiveArgs = args;
  if (typeof args === "string") {
    switch (toolName) {
      case "run_bash":       effectiveArgs = { command: args }; break;
      case "web_search":     effectiveArgs = { query: args };   break;
      case "inspect_codebase":
      case "detect_stack":
        effectiveArgs = { path: args };
        break;
      default:               effectiveArgs = {};
    }
  }
  const base = { ...(effectiveArgs ?? {}) };
  const lockedRoot = getLockedProjectRoot(threadId);

  if (lockedRoot) {
    const pathTools = [
      "read_file",
      "write_file",
      "search_replace",
      "list_directory",
      "grep_code",
      "glob_files",
      "search_files",
      "semantic_search",
      "inspect_codebase",
      "detect_stack",
      "inspect_ast",
      "verify_project",
      "check_syntax",
      "read_lints",
      "delete_file",
      "read_files",
    ];
    if (pathTools.includes(toolName)) {
      const enforced = enforceProjectPath(toolName, base.path ?? ".", lockedRoot);
      if (enforced.error) throw new Error(enforced.error);
      base.path = enforced.path;
      if (enforced.message) {
        base._pathRewritten = base._pathRewritten
          ? `${base._pathRewritten}\n${enforced.message}`
          : enforced.message;
      }
    }
    if (toolName === "run_bash" || toolName === "run_check") {
      if (lockedRoot && lockedRoot !== ".") {
        base.cwd = lockedRoot;
      }
    }
    if (toolName === "apply_template") {
      base.projectDir = lockedRoot;
    }
  }

  if (toolName === "list_directory" && !base.path) {
    base.path = lockedRoot ?? getThreadCwd(threadId);
  }

  if (
    toolName === "read_file" ||
    toolName === "write_file" ||
    toolName === "search_replace" ||
    toolName === "read_lints" ||
    toolName === "delete_file"
  ) {
    const pathDeps = { getThreadCwd, getActiveProjectRoot };
    const resolved =
      toolName === "write_file" || toolName === "search_replace"
        ? await resolveWriteCodebasePath(threadId, base.path, pathDeps)
        : await resolveCodebasePath(threadId, base.path, pathDeps);

    if (toolName === "write_file" || toolName === "search_replace") {
      const validation = validateWritePath(resolved.path, {
        activeProject: getActiveProjectRoot(threadId),
        cwd: getThreadCwd(threadId),
        userMessage: userMessage || base._userMessage,
        knownPaths: getKnownPaths(threadId),
      });
      if (!validation.allowed) {
        throw new Error(validation.message);
      }
      base.path = validation.path;
    } else {
      const readValidation = validateReadPath(resolved.path, {
        activeProject: getActiveProjectRoot(threadId),
        cwd: getThreadCwd(threadId),
      });
      base.path = readValidation.path;
      if (readValidation.rewritten) {
        base._pathRewritten = readValidation.message;
      }
    }
  }

  if (toolName === "read_files" && Array.isArray(base.paths)) {
    const pathDeps = { getThreadCwd, getActiveProjectRoot };
    const resolvedPaths = [];
    for (const p of base.paths) {
      const resolved = await resolveCodebasePath(threadId, p, pathDeps);
      const readValidation = validateReadPath(resolved.path, {
        activeProject: getActiveProjectRoot(threadId),
        cwd: getThreadCwd(threadId),
      });
      resolvedPaths.push(readValidation.path);
    }
    base.paths = resolvedPaths;
  }

  if (toolName === "run_bash" || toolName === "run_check") {
    const cwd = await resolveBashCwd(threadId, base.cwd, base.command ?? "", {
      getThreadCwd,
      getActiveProjectRoot,
    });
    base.cwd = cwd;
    const lockForBash =
      lockedRoot && lockedRoot !== "." ? lockedRoot : null;
    if (lockForBash && base.command) {
      const normalized = normalizeBashCommandForLockedRoot(
        base.command,
        lockForBash,
        cwd,
      );
      if (normalized.rewritten) {
        base.command = normalized.command;
        base._pathRewritten = base._pathRewritten
          ? `${base._pathRewritten}\n${normalized.notes.join("\n")}`
          : normalized.notes.join("\n");
      }
    }
  }

  if (toolName === "grep_code" || toolName === "glob_files") {
    base.path =
      base.path ??
      lockedRoot ??
      getActiveProjectRoot(threadId) ??
      getThreadCwd(threadId);
  }

  if (toolName === "semantic_search") {
    base.path =
      base.path ??
      lockedRoot ??
      getActiveProjectRoot(threadId) ??
      getThreadCwd(threadId);
  }

  if (
    toolName === "verify_project" ||
    toolName === "inspect_codebase" ||
    toolName === "detect_stack"
  ) {
    if (lockedRoot && lockedRoot !== ".") {
      base.path = lockedRoot;
    } else {
      const hasExplicitPath = base.path && base.path !== ".";
      if (hasExplicitPath) {
        const resolved = await resolveCodebasePath(threadId, base.path, {
          getThreadCwd,
          getActiveProjectRoot,
        });
        base.path = resolved.path;
      } else if (toolName === "verify_project") {
        const { inferVerifyProjectPath } = await import(
          "./codeCheck/resolveVerifyRoot.js"
        );
        const inferred = await inferVerifyProjectPath(threadId);
        base.path =
          inferred ??
          (getActiveProjectRoot(threadId) &&
          getActiveProjectRoot(threadId) !== "."
            ? getActiveProjectRoot(threadId)
            : getThreadCwd(threadId));
      } else {
        const active = getActiveProjectRoot(threadId);
        base.path =
          active && active !== "." ? active : getThreadCwd(threadId);
      }
    }
  }

  return base;
}

function isProjectTask(message) {
  return requiresAgentTaskPlan(message);
}

function userReportedError(message) {
  return ERROR_REPORT_PATTERNS.some((p) => p.test(message));
}

function userWantsFix(message) {
  return /\b(fix|repair|debug|resolve|correct)\b/i.test(message) ||
    /\b(still|only see|not working|doesn't work|does not work|broken|wrong)\b/i.test(message);
}

function agentGaveUpOrDenied(reply) {
  return (
    AGENT_GIVE_UP_PATTERNS.some((p) => p.test(reply)) ||
    CODE_DENIAL_PATTERNS.some((p) => p.test(reply))
  );
}

function agentAskedManualSteps(reply) {
  return MANUAL_STEP_PATTERNS.some((p) => p.test(reply));
}

function usedReadFile(toolEvents) {
  return toolEvents.some((e) => e.name === "read_file");
}

function usedRunBash(toolEvents) {
  return toolEvents.some((e) => e.name === "run_bash");
}

function extractErrorFilePath(message) {
  const match = message.match(
    /(?:^|\s)([\w./-]+\.(?:vue|ts|js|tsx|jsx|svelte))(?::\d+)?(?:\s|$)/m,
  );
  return match?.[1] ?? null;
}

function shouldForceErrorFix(message, reply, toolEvents) {
  if (agentGaveUpOrDenied(reply) && (isProjectTask(message) || usedWriteFile(toolEvents))) {
    return true;
  }

  if (!userReportedError(message) && !userWantsFix(message)) return false;
  if (agentAskedManualSteps(reply) && isProjectTask(message)) return true;

  if (!usedReadFile(toolEvents) && !usedWriteFile(toolEvents)) return true;

  const cited = extractErrorFilePath(message);
  if (cited && userReportedError(message)) {
    const readPaths = toolEvents
      .filter((e) => e.name === "read_file")
      .map((e) => e.args?.path ?? "")
      .join(" ");
    if (!readPaths.includes(cited.split("/").pop())) return true;
  }

  if (
    userReportedError(message) &&
    isProjectTask(message) &&
    !usedRunBash(toolEvents) &&
    !usedWriteFile(toolEvents)
  ) {
    return true;
  }

  return false;
}

function shouldForceToolUse(message, reply, toolEvents) {
  if (agentGaveUpOrDenied(reply) && isProjectTask(message)) return true;
  if (/\b(use the tools|yes use tools|use tools)\b/i.test(message)) {
    return !toolEvents.length;
  }
  if (isProjectTask(message) && !toolEvents.length) {
    return (
      FALSE_PROJECT_CLAIM_PATTERNS.some((p) => p.test(reply)) ||
      agentAskedManualSteps(reply)
    );
  }
  return false;
}

function usedCodebaseInspect(toolEvents) {
  return toolEvents.some((e) => e.name === "inspect_codebase");
}

function usedTaskPlan(toolEvents) {
  return toolEvents.some((e) => e.name === "update_task_plan");
}

function usedWriteFile(toolEvents) {
  return toolEvents.some(
    (e) => e.name === "write_file" || e.name === "search_replace",
  );
}

function usedCodebaseExploration(toolEvents) {
  return toolEvents.some((e) =>
    [
      "search_files",
      "inspect_codebase",
      "detect_stack",
      "inspect_ast",
      "grep_code",
      "glob_files",
      "semantic_search",
      "read_file",
      "list_directory",
    ].includes(e.name),
  );
}

const PATH_CONFIRM_TOOLS = new Set(["search_replace", "delete_file"]);

function hadSearchCoveringPath(toolEvents, targetPath) {
  if (!targetPath) return false;
  for (const event of toolEvents) {
    if (event.type !== "tool_result" || event.name !== "search_files") continue;
    if (searchResultCoversPath(event.content, targetPath)) return true;
  }
  return false;
}

/** Gate updates/deletes only — write_file may create new paths without a search hit. */
function pathSearchBlockMessage(toolName, normalizedArgs, toolEvents) {
  if (!PATH_CONFIRM_TOOLS.has(toolName)) return null;

  const targetPath = normalizedArgs?.path;
  if (!targetPath) return null;

  if (!hadSuccessfulTool(toolEvents, "search_files")) {
    return (
      `Call search_files first to confirm the path for ${toolName}.\n` +
      `Example: {"tool":"search_files","args":{"query":"${String(targetPath).split("/").pop()}"}}`
    );
  }

  if (!hadSearchCoveringPath(toolEvents, targetPath)) {
    return (
      `search_files did not return "${targetPath}".\n` +
      `Run search_files with the correct filename or partial path, then retry ${toolName} using an exact path from the results.`
    );
  }

  return null;
}

function isBlockedWithoutExploration(toolName, userMessage, toolEvents, threadId) {
  if (!isProjectTask(userMessage)) return false;
  if (!["write_file", "search_replace", "apply_template"].includes(toolName)) {
    return false;
  }
  if (isAwarenessSatisfied(threadId, toolEvents)) return false;
  return !usedCodebaseExploration(toolEvents);
}

function shouldForceCodebaseSearch(userMessage, reply, toolEvents) {
  if (!isProjectTask(userMessage)) return false;
  if (usedCodebaseExploration(toolEvents)) return false;
  if (usedWriteFile(toolEvents)) return false;
  if (FALSE_PROJECT_CLAIM_PATTERNS.some((p) => p.test(reply))) return true;
  return false;
}

function shouldForcePlanning(userMessage, reply, toolEvents, threadId) {
  if (!isProjectTask(userMessage)) return false;
  if (webResearchRequiredForTurn(threadId, toolEvents, userMessage)) return false;
  if (hasValidPlan(threadId) || usedTaskPlan(toolEvents)) return false;
  if (usedWriteFile(toolEvents)) return false;
  if (FALSE_PROJECT_CLAIM_PATTERNS.some((p) => p.test(reply))) return true;
  if (getExecutionPhase(userMessage, toolEvents, threadId) === "plan") return true;
  if (!toolEvents.length) return true;
  return false;
}

function shouldForceCodebaseInspect(userMessage, reply, toolEvents, threadId) {
  if (!isProjectTask(userMessage)) return false;
  if (usedCodebaseInspect(toolEvents)) return false;
  if (usedWriteFile(toolEvents)) return false;
  if (getActiveProjectRoot(threadId)) return false;
  if (toolEvents.some((e) => e.name === "read_file")) return false;
  return (
    !toolEvents.length ||
    FALSE_PROJECT_CLAIM_PATTERNS.some((p) => p.test(reply))
  );
}

function isBlockedWithoutProjectContext(toolName, userMessage, threadId, toolEvents) {
  if (toolName !== "write_file" && toolName !== "search_replace") return false;
  if (!isProjectTask(userMessage)) return false;
  if (isAwarenessSatisfied(threadId, toolEvents)) {
    const preflight = getTurnAwareness(threadId)?.preflight;
    if (preflight?.greenfieldScaffold) return false;
  }
  const active = getActiveProjectRoot(threadId);
  if (active && active !== ".") return false;
  if (usedCodebaseInspect(toolEvents)) return false;
  return true;
}

function shouldForceInspectBeforeWrite(userMessage, toolEvents, threadId) {
  if (!isProjectTask(userMessage)) return false;
  if (!usedWriteFile(toolEvents)) return false;
  if (usedCodebaseInspect(toolEvents)) return false;
  if (getActiveProjectRoot(threadId)) return false;
  return hasUnresolvedPathWarnings(toolEvents);
}

function shouldForcePathCorrection(userMessage, reply, toolEvents) {
  if (!hasUnresolvedPathWarnings(toolEvents)) return false;
  return isProjectTask(userMessage) || usedWriteFile(toolEvents);
}

function getVerifyFailReadRequirement(toolEvents) {
  const lastVerify = getLastVerifyResult(toolEvents);
  if (!lastVerify || lastVerify.passed) return null;

  const verifyIdx = toolEvents.findLastIndex(
    (e) => e.name === "verify_project" && e.type === "tool_result",
  );
  if (verifyIdx < 0) return null;

  const { files } = extractVerificationErrors(lastVerify.content ?? "");
  if (!files.length) return null;

  const sinceVerify = toolEvents.slice(verifyIdx + 1);
  const readPaths = sinceVerify
    .filter((e) => e.name === "read_file")
    .map((e) => e.args?.path ?? "");
  const readAnyCited = files.some((f) =>
    readPaths.some((rp) => rp === f || rp.endsWith(`/${f}`) || f.endsWith(rp)),
  );
  if (readAnyCited) return null;

  return { files, sinceVerify };
}

function shouldForceReadBeforeFixOnVerifyFail(toolEvents) {
  const req = getVerifyFailReadRequirement(toolEvents);
  if (!req) return false;
  return req.sinceVerify.some(
    (e) => e.name === "search_replace" || e.name === "write_file",
  );
}

function isBlockedEditWithoutReadOnVerifyFail(toolName, toolEvents) {
  if (toolName !== "search_replace" && toolName !== "write_file") return false;
  return Boolean(getVerifyFailReadRequirement(toolEvents));
}

function shouldVerifyAfterWrite(userMessage, reply, toolEvents, threadId) {
  if (shouldSkipPostWriteVerification(toolEvents, threadId)) return false;
  if (hasUnresolvedPathWarnings(toolEvents)) return true;
  if (!usedWriteFile(toolEvents)) return false;

  if (isProjectTask(userMessage) && !hasReadBackAfterWrites(toolEvents, threadId)) {
    return true;
  }
  if (
    isProjectTask(userMessage) &&
    FALSE_PROJECT_CLAIM_PATTERNS.some((p) => p.test(reply))
  ) {
    return true;
  }
  return false;
}

function drainPlanEvents(pendingPlanEvents) {
  return pendingPlanEvents.splice(0, pendingPlanEvents.length);
}

function usedRemember(toolEvents) {
  return toolEvents.some((e) => e.name === "remember");
}

function usedLearnSkill(toolEvents) {
  return toolEvents.some((e) => e.name === "learn_skill");
}

function userWantsBrainSave(userMessage) {
  return BRAIN_SAVE_PATTERNS.some((p) => p.test(userMessage));
}

function claimsSavedWithoutRemember(reply, toolEvents) {
  if (usedRemember(toolEvents)) return false;
  return FALSE_SAVE_CLAIM_PATTERNS.some((p) => p.test(reply));
}

function shouldForceRemember(userMessage, reply, toolEvents, threadId) {
  if (usedRemember(toolEvents)) return false;
  if (getTurnIntent(threadId)?.saveToMemory) return true;
  return userWantsBrainSave(userMessage) || claimsSavedWithoutRemember(reply, toolEvents);
}

function shouldForceWebSearch(userMessage, reply, toolEvents, threadId) {
  if (usedWebSearch(toolEvents)) return false;
  const intent = getTurnIntent(threadId);
  if (intent?.casualChat) return false;

  const factual =
    isWebResearchQuestion(userMessage) ||
    hasSearchIntent(userMessage) ||
    intent?.allowWebSearch;

  if (!factual) return false;

  if (hasSearchIntent(userMessage) && /\b(search|look up|google)\b/i.test(userMessage)) {
    return true;
  }

  if (usedRecallBrain(toolEvents)) return true;

  if (UNCERTAIN_REPLY_PATTERNS.some((p) => p.test(reply))) return true;

  return false;
}

async function executeTool(tool, name, args, threadId, userMessage = "") {
  let normalized;
  try {
    const resolved = await resolveToolArgs(name, args, threadId, userMessage);
    normalized = sanitizeToolArgs(name, resolved);
  } catch (error) {
    return {
      display: `Path resolution error for ${name}: ${error.message}`,
      raw: null,
    };
  }

  try {
    let result = await tool.invoke(normalized, {
      configurable: { threadId },
    });
    const raw = result;
    await updateCwdFromTool(threadId, name, normalized);

    const activeProject = getActiveProjectRoot(threadId);

    if (name === "read_file" && normalized.path) {
      recordFileAccess(threadId, normalized.path, "read", {
        project: activeProject,
      });
      const header = formatReadFileHeader(normalized.path, { activeProject });
      const rewriteNote = normalized._pathRewritten
        ? `${normalized._pathRewritten}\n\n`
        : "";
      result =
        rewriteNote +
        header +
        (typeof result === "string" ? result : String(result));
    } else if (name === "write_file" && normalized.path) {
      recordFileAccess(threadId, normalized.path, "write", {
        project: activeProject,
      });
      const writePath = String(normalized.path).replace(/\\/g, "/");
      if (/(?:^|\/)package\.json$/.test(writePath)) {
        const projectDir = writePath.includes("/")
          ? writePath.slice(0, writePath.lastIndexOf("/"))
          : ".";
        if (projectDir && projectDir !== ".") {
          const { setActiveProjectRootInMemory } = await import("./workspace.js");
          setActiveProjectRootInMemory(threadId, projectDir);
          recordProjectHint(threadId, projectDir);
        }
      } else if (activeProject) {
        recordProjectHint(threadId, activeProject);
      }
      const bytes =
        typeof result === "object" && result?.bytes != null
          ? result.bytes
          : String(normalized.content ?? "").length;
      result = await enrichWriteFileResult(
        threadId,
        normalized.path,
        bytes,
        getActiveProjectRoot,
      );
    } else if (name === "search_replace" && normalized.path) {
      recordFileAccess(threadId, normalized.path, "search-replace", {
        project: activeProject,
      });
      if (activeProject) recordProjectHint(threadId, activeProject);
      const bytes =
        typeof result === "object" && result?.bytes != null ? result.bytes : 0;
      result = await enrichWriteFileResult(
        threadId,
        normalized.path,
        bytes,
        getActiveProjectRoot,
      );
    } else if (name === "search_files") {
      const text = typeof result === "string" ? result : String(result);
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("→") || /^RESULT:/i.test(trimmed)) continue;
        const pathMatch = trimmed.match(/^\.?\/?([\w./-]+\.\w[\w.-]*)$/);
        if (pathMatch?.[1]) {
          recordFileAccess(threadId, pathMatch[1].replace(/^\.\//, ""), "search-hit");
        }
      }
    } else if (name === "list_directory") {
      const dir = normalized.path ?? getThreadCwd(threadId);
      recordDirectoryListing(
        threadId,
        dir,
        typeof result === "string" ? result : String(result),
      );
      recordFileAccess(threadId, dir, "list-dir");
    } else if (name === "grep_code" || name === "glob_files" || name === "semantic_search") {
      const text = typeof result === "string" ? result : String(result);
      for (const line of text.split("\n").slice(0, 30)) {
        const match =
          line.match(/^\d+\.\s+\[[\d.]+\]\s+([^:\n]+:\d+-\d+|[^:\n]+\.\w+)/) ??
          line.match(/^([^:\n]+\.\w+):\d+:/) ??
          line.match(/^(?:file\s+)?([\w./-]+\.\w+)/);
        if (match?.[1]) recordFileAccess(threadId, match[1].split(":")[0], "semantic-hit");
      }
    } else if (name === "inspect_codebase") {
      const { describeCodebase } = await import("./codebase/context.js");
      const info = await describeCodebase(
        normalized.path ?? getThreadCwd(threadId),
      );
      if (info.projectRoot) {
        recordInspectResult(threadId, {
          projectRoot: info.projectRoot,
          projectType: info.projectType,
          entryHints: info.entryHints,
          files: info.files,
        });
        ensureWorkspaceFileMap(threadId, {
          root: info.projectRoot,
          force: true,
        }).catch((err) => {
          console.warn("[workspaceFileMap]", err?.message ?? err);
        });
        if (config.semanticSearch.enabled) {
          import("./codebase/searchIndex.js")
            .then(({ ensureProjectIndexed }) =>
              ensureProjectIndexed(info.projectRoot).catch(() => {}),
            )
            .catch(() => {});
        }
      }
      if (activeProject) recordProjectHint(threadId, activeProject);
      recordFileAccess(threadId, activeProject ?? normalized.path ?? ".", "inspect");
    } else if (typeof result === "object") {
      result = JSON.stringify(result);
    }

    const display = typeof result === "string" ? result : JSON.stringify(result);
    return { display, raw, normalized };
  } catch (error) {
    if (
      error?.name === "ToolInputParsingException" ||
      error?.message?.includes("expected schema")
    ) {
      const schema = describeToolSchema(name);
      const received = error?.output ?? JSON.stringify(normalized);
      return {
        display:
          `Tool argument error for ${name}: ${error.message}\n` +
          `Expected args shape: ${schema}\n` +
          `Received: ${received}\n` +
          `Retry ${name} with valid JSON args matching the shape above.\n` +
          `Do not continue until you have retried with the correct args.`,
        raw: null,
      };
    }
    if (error?.code === "ENOENT") {
      const target = normalized?.path ?? normalized?.command ?? name;
      return {
        display:
          `ENOENT: ${error.message}\n` +
          (normalized?.path
            ? `Path "${normalized.path}" does not exist. ` +
              `Use write_file to create files (dirs are auto-created) or mkdir -p for directories.`
            : "Check the path exists before using this tool."),
        raw: null,
      };
    }
    throw error;
  }
}

async function buildWorkbenchEvents(toolName, normalized, raw, threadId) {
  const events = [];

  if (toolName === "write_file" && raw && typeof raw === "object") {
    const { path: filePath, before, after, action } = raw;
    if (filePath && after != null) {
      const payload = buildFileChangePayload(
        filePath,
        before ?? "",
        after,
        action ?? "modified",
      );
      const entry = recordFileChange(threadId, payload);
      events.push({
        type: "file_change",
        id: entry.id,
        path: entry.path,
        action: entry.action,
        stats: entry.stats,
        diff: entry.diff,
        unified: entry.unified,
        truncated: entry.truncated,
      });
    }
  }

  if (toolName === "search_replace" && raw && typeof raw === "object") {
    const { path: filePath, before, after, action } = raw;
    if (filePath && after != null) {
      const payload = buildFileChangePayload(
        filePath,
        before ?? "",
        after,
        action ?? "modified",
      );
      const entry = recordFileChange(threadId, payload);
      events.push({
        type: "file_change",
        id: entry.id,
        path: entry.path,
        action: entry.action,
        stats: entry.stats,
        diff: entry.diff,
        unified: entry.unified,
        truncated: entry.truncated,
      });
    }
  }

  if (toolName === "read_file" && normalized?.path) {
    try {
      const file = await readWorkspaceFile(normalized.path);
      if (!file.binary && file.content) {
        const { preview, lineCount } = buildFileOpenPreview(file.content);
        events.push({
          type: "file_open",
          path: file.path,
          language: file.language ?? detectLanguage(file.path),
          lineCount,
          preview,
        });
      }
    } catch {
      // ignore preview errors
    }
  }

  return events;
}

function withCallId(event, toolRequest) {
  if (toolRequest?.id) {
    event.callId = toolRequest.id;
  }
  return event;
}

/**
 * Preflight one read-only tool for parallel batch execution.
 * @returns {Promise<{ kind: "abort" } | { kind: "blocked", callEvent, resultEvent, llmContent } | { kind: "ready", toolRequest, normalizedArgs, tool }>}
 */
async function preflightParallelReadOnlyTool(toolRequest, ctx) {
  const { threadId, message, toolEvents, toolByName, minimalChat } = ctx;

  if (isAskModeTurn(threadId) && !ASK_MODE_TOOLS.has(toolRequest.name)) {
    const callEvent = withCallId(
      { type: "tool_call", name: toolRequest.name, args: toolRequest.args ?? {} },
      toolRequest,
    );
    const skip = askModeSkipMessage();
    return {
      kind: "blocked",
      callEvent,
      resultEvent: withCallId(
        { type: "tool_result", name: toolRequest.name, content: skip },
        toolRequest,
      ),
      llmContent: skip,
    };
  }

  const turnIntent = getTurnIntent(threadId);
  if (turnIntent?.casualChat && !CASUAL_CHAT_TOOLS.has(toolRequest.name)) {
    const callEvent = withCallId(
      { type: "tool_call", name: toolRequest.name, args: toolRequest.args ?? {} },
      toolRequest,
    );
    const skip = casualChatSkipMessage();
    return {
      kind: "blocked",
      callEvent,
      resultEvent: withCallId(
        { type: "tool_result", name: toolRequest.name, content: skip },
        toolRequest,
      ),
      llmContent: skip,
    };
  }

  if (
    toolRequest.name === "web_search" &&
    isWebSearchLimitReached(threadId)
  ) {
    return { kind: "abort" };
  }

  const executionGate = checkExecutionGate(toolRequest.name, {
    message,
    toolEvents,
    threadId,
  });
  if (executionGate.blocked) {
    const callEvent = withCallId(
      { type: "tool_call", name: toolRequest.name, args: toolRequest.args ?? {} },
      toolRequest,
    );
    const gatedContent = appendToolStatus(
      toolRequest.name,
      executionGate.message ?? "Tool blocked — wrong execution phase.",
    );
    return {
      kind: "blocked",
      callEvent,
      resultEvent: withCallId(
        { type: "tool_result", name: toolRequest.name, content: gatedContent },
        toolRequest,
      ),
      llmContent:
        executionGate.phase === "research"
          ? buildWebResearchRetryMessage(message, {
              activeProject: getActiveProjectRoot(threadId),
            })
          : `Tool error: ${executionGate.message}`,
    };
  }

  let normalizedArgs;
  let tool = toolByName.get(toolRequest.name);
  try {
    const resolved = await resolveToolArgs(
      toolRequest.name,
      toolRequest.args,
      threadId,
      message,
    );
    normalizedArgs = sanitizeToolArgs(toolRequest.name, resolved);

    if (toolRequest.name === "run_bash") {
      const inferred = inferRunBashCommand(normalizedArgs);
      if (inferred && !String(normalizedArgs.command ?? "").trim()) {
        normalizedArgs = { ...normalizedArgs, command: inferred };
      }
    }
  } catch (error) {
    const errMsg = String(error?.message ?? error);
    const msg = `Path resolution error: ${errMsg}`;
    return {
      kind: "blocked",
      callEvent: withCallId(
        { type: "tool_call", name: toolRequest.name, args: toolRequest.args ?? {} },
        toolRequest,
      ),
      resultEvent: withCallId(
        { type: "tool_result", name: toolRequest.name, content: msg },
        toolRequest,
      ),
      llmContent: `Tool error: ${msg}`,
    };
  }

  const fsGate = await checkFilesystemAwarenessGate(
    toolRequest.name,
    normalizedArgs,
    { threadId, getTurnAwareness, getLockedProjectRoot },
  );
  if (fsGate.blocked) {
    const callEvent = withCallId(
      { type: "tool_call", name: toolRequest.name, args: normalizedArgs },
      toolRequest,
    );
    const fsGateBody = fsGate.statusLine
      ? `${fsGate.statusLine}\n${fsGate.message ?? ""}`
      : (fsGate.message ?? "Tool skipped — filesystem awareness.");
    const gatedContent = appendToolStatus(toolRequest.name, fsGateBody);
    return {
      kind: "blocked",
      callEvent,
      resultEvent: withCallId(
        { type: "tool_result", name: toolRequest.name, content: gatedContent },
        toolRequest,
      ),
      llmContent: fsGate.message ?? "Filesystem awareness skip.",
    };
  }

  const pathSearchBlock = pathSearchBlockMessage(
    toolRequest.name,
    normalizedArgs,
    toolEvents,
  );
  if (pathSearchBlock) {
    const callEvent = withCallId(
      { type: "tool_call", name: toolRequest.name, args: normalizedArgs },
      toolRequest,
    );
    return {
      kind: "blocked",
      callEvent,
      resultEvent: withCallId(
        { type: "tool_result", name: toolRequest.name, content: pathSearchBlock },
        toolRequest,
      ),
      llmContent: `Tool error: ${pathSearchBlock}`,
    };
  }

  let effectiveRequest = toolRequest;
  const astRedirect = detectAstReadRedirect(
    toolRequest.name,
    normalizedArgs,
    toolEvents,
    { codingTurn: !minimalChat },
  );
  if (astRedirect) {
    if (!config.astReadGate.redirectToInspect) {
      const gateMsg = buildReadFileGateMessage(astRedirect.path);
      const callEvent = withCallId(
        { type: "tool_call", name: toolRequest.name, args: normalizedArgs ?? {} },
        toolRequest,
      );
      const gatedContent = appendToolStatus(toolRequest.name, gateMsg);
      return {
        kind: "blocked",
        callEvent,
        resultEvent: withCallId(
          { type: "tool_result", name: toolRequest.name, content: gatedContent },
          toolRequest,
        ),
        llmContent: gateMsg,
      };
    }
    effectiveRequest = { ...toolRequest, name: "inspect_ast", args: astRedirect.inspectArgs };
    try {
      const resolved = await resolveToolArgs(
        "inspect_ast",
        astRedirect.inspectArgs,
        threadId,
        message,
      );
      normalizedArgs = sanitizeToolArgs("inspect_ast", resolved);
      tool = toolByName.get("inspect_ast");
    } catch (error) {
      const msg = `AST redirect error: ${error.message}`;
      return {
        kind: "blocked",
        callEvent: withCallId(
          { type: "tool_call", name: "inspect_ast", args: astRedirect.inspectArgs },
          effectiveRequest,
        ),
        resultEvent: withCallId(
          { type: "tool_result", name: "inspect_ast", content: msg },
          effectiveRequest,
        ),
        llmContent: `Tool error: ${msg}`,
      };
    }
  }

  if (toolRequest.name === "web_search") {
    const resolved = resolveWebSearchEngines({
      requested: normalizedArgs.engines,
      threadId,
    });
    if (resolved.engines && !normalizedArgs.engines) {
      normalizedArgs = { ...normalizedArgs, engines: resolved.engines };
    }
  }

  if (!tool) {
    const suggested = suggestToolName(effectiveRequest.name, ctx.knownToolNames);
    const error = suggested
      ? `Unknown tool: ${effectiveRequest.name}. Did you mean "${suggested}"?`
      : `Unknown tool: ${effectiveRequest.name}. Available: ${[...ctx.knownToolNames].join(", ")}`;
    return {
      kind: "blocked",
      callEvent: withCallId(
        { type: "tool_call", name: effectiveRequest.name, args: normalizedArgs },
        effectiveRequest,
      ),
      resultEvent: withCallId(
        {
          type: "tool_result",
          name: effectiveRequest.name,
          content: appendToolStatus(effectiveRequest.name, error),
        },
        effectiveRequest,
      ),
      llmContent: `Tool error: ${error}`,
    };
  }

  return {
    kind: "ready",
    toolRequest: effectiveRequest,
    normalizedArgs,
    tool,
  };
}

async function* finalizeParallelToolResult(ctx, prepared, toolOutcome) {
  const {
    threadId,
    message,
    conversation,
    step,
    toolEvents,
    workspaceEvents,
    pendingPlanEvents,
    retainTaskPlan,
    minimalChat,
    tools,
  } = ctx;
  const { toolRequest, normalizedArgs } = prepared;
  const result = toolOutcome.display;

  {
    const entry = { tool: toolRequest.name };
    if (normalizedArgs.path) entry.path = normalizedArgs.path;
    if (normalizedArgs.command) entry.command = normalizedArgs.command;
    if (normalizedArgs.cwd) entry.cwd = normalizedArgs.cwd;
    const exitMatch = String(result ?? "").match(/exit (\d+)/);
    if (exitMatch) entry.exitCode = Number(exitMatch[1]);
    if (toolOutcome.raw?.bytes != null) entry.bytes = toolOutcome.raw.bytes;
    else if (normalizedArgs.content) entry.bytes = normalizedArgs.content.length;
    recordAction(threadId, entry);
  }

  for (const wbEvent of await buildWorkbenchEvents(
    toolRequest.name,
    toolOutcome.normalized,
    toolOutcome.raw,
    threadId,
  )) {
    yield wbEvent;
  }

  for (const planEvent of drainPlanEvents(pendingPlanEvents)) {
    yield planEvent;
  }

  const planDone = await syncPlanStep(threadId, {
    toolName: toolRequest.name,
    phase: "done",
    succeeded: /^STATUS: SUCCESS/m.test(
      appendToolStatus(toolRequest.name, result),
    ),
    retainPlan: retainTaskPlan,
  });
  if (planDone) yield planDone;

  const storedResult = minifyToolResult(toolRequest.name, result);
  const statusResult = appendToolStatus(toolRequest.name, result);
  const skipPlanHint =
    toolRequest.name === "mark_plan_step" ||
    /^STATUS: (FAIL|BLOCKED)/m.test(statusResult) ||
    (planDone && toolRequest.name !== "mark_plan_step");
  const planHint = skipPlanHint ? "" : planStepHint(threadId);
  const displayResult = planHint ? `${statusResult}${planHint}` : statusResult;

  const resultEvent = attachResultSummary(
    withCallId(
      {
        type: "tool_result",
        name: toolRequest.name,
        content: displayResult.slice(0, 2400),
        ...(toolRequest.name === "web_search" && normalizedArgs.engines
          ? { engines: normalizedArgs.engines }
          : {}),
        ...(COMMAND_RESULT_TOOLS.has(toolRequest.name)
          ? {
              resultSummary: parseCommandToolResult(
                toolRequest.name,
                statusResult,
                normalizedArgs,
              ),
            }
          : {}),
      },
      toolRequest,
    ),
    statusResult,
    normalizedArgs,
  );
  if (
    COMMAND_RESULT_TOOLS.has(toolRequest.name) &&
    resultEvent.resultSummary == null
  ) {
    const cmdSummary = parseCommandToolResult(
      toolRequest.name,
      statusResult,
      normalizedArgs,
    );
    if (cmdSummary) resultEvent.resultSummary = cmdSummary;
  }
  toolEvents.push(resultEvent);
  transcriptLog.record(threadId, "tool_result_full", {
    name: toolRequest.name,
    args: normalizedArgs,
    rawResult: result,
    displayResult,
    storedResult,
    minified: storedResult !== result,
  });
  yield resultEvent;
  if (toolRequest.name === "publish_user_app") {
    try {
      const parsed = JSON.parse(String(result));
      if (parsed?.event?.type === "user_app_published") {
        yield parsed.event;
      } else if (parsed?.published && parsed?.app?.slug) {
        yield {
          type: "user_app_published",
          slug: parsed.app.slug,
          appId: parsed.app.id ?? parsed.app.slug,
        };
      }
    } catch {
      // ignore non-JSON tool output
    }
  }
  if (toolRequest.name === "import_user_app") {
    try {
      const parsed = JSON.parse(String(result));
      if (parsed?.event?.type === "user_app_published") {
        yield parsed.event;
      }
    } catch {
      // ignore non-JSON tool output
    }
  }
  await syncPlanFreezeAfterTool(threadId, toolRequest.name, displayResult);
  syncThreadVerifyFromToolResult(threadId, toolRequest.name, statusResult, {
    writtenPath: normalizedArgs?.path ?? normalizedArgs?.target_file ?? null,
  });
  if (
    isAwarenessTool(toolRequest.name) &&
    !/^STATUS: FAIL/m.test(displayResult) &&
    !/^Blocked /m.test(displayResult)
  ) {
    completeTurnAwareness(threadId);
  }

  if (toolRequest.name === "search_files") {
    const query = String(normalizedArgs?.query ?? toolRequest.args?.query ?? "").trim();
    if (
      query &&
      countToolCallsWithArgs(toolEvents, "search_files", "query", query) >= 2
    ) {
      ensureAwarenessComplete(threadId, toolEvents, "repeated-search");
      conversation.llmMessages.push({
        role: "user",
        content: buildRepeatedSearchFilesNudge(
          query,
          getCurrentPlanStep(threadId)?.label ?? null,
        ),
      });
    }
  }

  await captureFailureFromToolResult({
    threadId,
    userMessage: message,
    toolName: toolRequest.name,
    toolArgs: normalizedArgs,
    toolResultContent: displayResult,
    toolEvents,
  });
  markStackToolDone(
    threadId,
    toolRequest.name,
    String(result ?? "").slice(0, 100),
  );
  yield* yieldStack(threadId);

  const workspaceEvent = await buildWorkspaceEvent(threadId);
  workspaceEvents.push(workspaceEvent);
  if (!isMinimalChatTurn(threadId)) {
    yield workspaceEvent;
  }

  refreshSystemMessage(conversation, tools);

  if (toolRequest.native && toolRequest.id) {
    conversation.llmMessages.push(
      minifyLlmMessage({
        role: "tool",
        tool_call_id: toolRequest.id,
        content: planHint ? `${storedResult}${planHint}` : storedResult,
      }),
    );
  } else {
    conversation.llmMessages.push(
      minifyLlmMessage({
        role: "user",
        content: `Tool result for ${toolRequest.name}:\n${planHint ? `${storedResult}${planHint}` : storedResult}`,
      }),
    );
  }

  if (
    toolRequest.name === "web_search" &&
    isProjectTask(message) &&
    !webSearchResultsWereUseful(toolEvents)
  ) {
    conversation.llmMessages.push({
      role: "user",
      content: buildWebSearchTrainingFallbackBrief(),
    });
  }
}

async function* runParallelReadOnlyBatch(requests, ctx) {
  /** @type {Array<{ toolRequest: object, preflight: object }>} */
  const slots = [];

  for (const toolRequest of requests) {
    const preflight = await preflightParallelReadOnlyTool(toolRequest, ctx);
    if (preflight.kind === "abort") {
      ctx.conversation.llmMessages.push({
        role: "user",
        content: buildWebSearchFollowUpNudge(
          ctx.message,
          ctx.toolEvents,
          ctx.threadId,
        ),
      });
      return { abortTurn: true };
    }
    slots.push({ toolRequest, preflight });
  }

  const readySlots = slots.filter((s) => s.preflight.kind === "ready");
  const outcomes = await mapWithConcurrency(
    readySlots,
    config.toolParallel.concurrency,
    async (slot) =>
      executeTool(
        slot.preflight.tool,
        slot.preflight.toolRequest.name,
        slot.preflight.normalizedArgs,
        ctx.threadId,
        ctx.message,
      ),
  );

  let readyIndex = 0;
  for (const slot of slots) {
    const { toolRequest, preflight } = slot;

    if (preflight.kind === "blocked") {
      ctx.toolEvents.push(preflight.callEvent);
      yield preflight.callEvent;
      ctx.toolEvents.push(preflight.resultEvent);
      yield preflight.resultEvent;
      ctx.conversation.llmMessages.push({
        role: "user",
        content: preflight.llmContent,
      });
      continue;
    }

    const { normalizedArgs, tool } = preflight;
    const callEvent = withCallId(
      { type: "tool_call", name: toolRequest.name, args: normalizedArgs },
      toolRequest,
    );
    ctx.toolEvents.push(callEvent);
    yield callEvent;
    markStackToolStart(ctx.threadId, toolRequest.name, normalizedArgs);
    yield* yieldStack(ctx.threadId);

    const planStart = await syncPlanStep(ctx.threadId, {
      toolName: toolRequest.name,
      phase: "start",
      retainPlan: ctx.retainTaskPlan,
    });
    if (planStart) yield planStart;

    yield {
      type: "status",
      phase: "tool",
      step: ctx.step + 1,
      tool: toolRequest.name,
      message: `Running ${toolRequest.name}…`,
    };

    const toolOutcome = outcomes[readyIndex++];
    yield* finalizeParallelToolResult(ctx, preflight, toolOutcome);
  }

  return { abortTurn: false };
}

async function* streamModel(
  messages,
  { minimalChat = false, step = 0, suppressReasoningStream = false } = {},
) {
  let assistantMessage = { role: "assistant", content: "" };
  let reasoning = "";
  let usage = {};
  let streamedContent = false;

  for await (const event of streamChatCompletion(messages, {
    slotId: getActiveSlotId(),
  })) {
    if (event.type === "delta") {
      if (event.field === "content") {
        streamedContent = true;
        yield { type: "message_delta", content: event.text };
      } else if (
        event.field === "reasoning" &&
        !minimalChat &&
        !suppressReasoningStream
      ) {
        yield { type: "reasoning_delta", content: event.text, step: step + 1 };
      }
    } else if (event.type === "done") {
      assistantMessage = event.message;
      reasoning = event.reasoning ?? "";
      usage = event.usage ?? {};
    }
  }

  yield {
    type: "model_done",
    message: assistantMessage,
    reasoning,
    usage,
    streamedContent,
  };
}

async function buildWorkspaceEvent(threadId, viewPath) {
  const cwd = getThreadCwd(threadId);
  const listing = await listWorkspace(viewPath ?? cwd);
  return {
    type: "workspace",
    workspace: listing.workspace,
    cwd,
    path: listing.path,
    entries: listing.entries,
  };
}

function maybeSetTitle(conversation, userMessage) {
  if (
    conversation.title === "New conversation" &&
    userMessage?.trim()
  ) {
    conversation.title = userMessage.trim().slice(0, 60);
  }
}

function serializeAssistantMessage(message) {
  return minifyLlmMessage({
    role: "assistant",
    content: message.content ?? "",
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
  });
}

function trimShellOutput(output, max = 4000) {
  if (!output) return "(no output)";
  return output.length > max ? `…${output.slice(-max)}` : output;
}

async function persistShellTurn(
  conversation,
  threadId,
  lastEvent,
  command,
  { recordLlm = false } = {},
) {
  const session = getShellSession(threadId);
  const output = lastEvent?.output ?? session?.rawOutput ?? "";

  if (lastEvent?.type === "shell_input_required") {
    const plain = trimShellOutput(
      lastEvent.tail ?? output,
      3000,
    );
    const reply = `$ ${command}\n${plain}\n\n⌨ Command is waiting for your input — type a response below.`;

    addUiMessage(conversation, {
      role: "assistant",
      content: reply,
      command: true,
      shell: { waiting: true, command },
    });
    if (recordLlm) {
      conversation.llmMessages.push({
        role: "assistant",
        content: `[Interactive command: ${command}]\n${plain}\n(waiting for user input)`,
      });
    }
    conversation.cwd = getThreadCwd(threadId);

    await saveConversation(conversation);
    const context = await getConversationContext(
      await resolveLlmMessages(conversation),
    );

    return {
      reply,
      context,
      shellWaiting: true,
      shellCommand: command,
    };
  }

  const exitCode = lastEvent?.exitCode ?? session?.exitCode ?? 0;
  const fullOut = trimShellOutput(lastEvent?.output ?? output, 5000);
  const reply = `$ ${command}\n${fullOut}\n\n(exit ${exitCode})`;

  addUiMessage(conversation, {
    role: "assistant",
    content: reply,
    command: true,
    shell: { waiting: false, command, exitCode },
  });
  if (recordLlm) {
    conversation.llmMessages.push({
      role: "assistant",
      content: `[Command: ${command}]\n${fullOut}\n(exit ${exitCode})`,
    });
  }
  conversation.cwd = getThreadCwd(threadId);

  const result = await finalizeResult({
    conversation,
    threadId,
    reply,
    toolEvents: [],
    workspaceEvents: [await buildWorkspaceEvent(threadId)],
  });

  return {
    reply: result.reply,
    context: result.context,
    autoCompacted: result.autoCompacted,
    shellWaiting: false,
    cwd: result.cwd,
    workspace: result.workspace,
    conversationId: result.conversationId,
  };
}

async function* yieldShellOutcome(
  conversation,
  threadId,
  lastEvent,
  command,
  options = {},
) {
  const outcome = await persistShellTurn(
    conversation,
    threadId,
    lastEvent,
    command,
    options,
  );

  yield { type: "context", ...outcome.context };
  if (outcome.autoCompacted) yield { type: "auto_compact" };

  const workspaceEvent = await buildWorkspaceEvent(threadId);
  yield workspaceEvent;

  yield {
    type: "message",
    node: "agent",
    content: outcome.reply,
    cwd: outcome.cwd ?? getThreadCwd(threadId),
    workspace: outcome.workspace ?? config.workspaceDir,
    conversationId: outcome.conversationId ?? threadId,
    direct: true,
    shellWaiting: outcome.shellWaiting,
    shellCommand: outcome.shellCommand ?? command,
  };
}

async function* streamInteractiveShell(
  conversation,
  threadId,
  command,
  options = {},
) {
  const cwd = getThreadCwd(threadId);
  let lastEvent = null;

  for await (const event of streamShellSession(threadId, command, cwd)) {
    lastEvent = event;
    yield event;
  }

  yield* yieldShellOutcome(conversation, threadId, lastEvent, command, options);
}

async function finalizeResult({
  conversation,
  threadId,
  reply,
  toolEvents,
  workspaceEvents,
  casualChat = false,
}) {
  await saveConversation(conversation);

  const autoCompact = await maybeAutoCompact(threadId, { skip: casualChat });
  const context =
    autoCompact?.context ??
    (await getConversationContext(
      await resolveLlmMessages(conversation, { casualChat }),
    ));

  return {
    reply,
    toolEvents,
    workspaceEvents,
    context,
    autoCompacted: autoCompact?.compacted ?? false,
    cwd: getThreadCwd(threadId),
    workspace: config.workspaceDir,
    messageCount: conversation.llmMessages.length,
    conversationId: threadId,
  };
}

async function* yieldChatFinish(
  result,
  { threadId, toolEvents, userMessage, reasoning } = {},
) {
  yield { type: "context", ...result.context };
  if (result.autoCompacted) yield { type: "auto_compact" };
  yield {
    type: "message",
    node: "agent",
    content: result.reply,
    cwd: result.cwd,
    workspace: result.workspace,
    conversationId: result.conversationId,
    ...(reasoning ? { reasoning } : {}),
    ...(serializeTaskPlan(threadId)
      ? { taskPlan: serializeTaskPlan(threadId) }
      : {}),
  };

  const reflect = await maybeAutoReflect(threadId, toolEvents, {
    mode: isAskModeTurn(threadId) ? "ask" : "chat",
    userMessage,
    casualChat: isMinimalChatTurn(threadId),
  });
  if (reflect) {
    yield {
      type: "auto_reflect",
      saved: reflect.saved,
    };
  }
}

async function captureFailureFromToolResult({
  threadId,
  userMessage,
  toolName,
  toolArgs,
  toolResultContent,
  toolEvents,
}) {
  try {
    const { tryCaptureFailure } = await import("./failureCapture.js");
    const { getActiveProjectRoot } = await import("./workspace.js");
    return tryCaptureFailure({
      threadId,
      userMessage,
      toolName,
      toolArgs,
      toolResultContent,
      toolEvents,
      project: getActiveProjectRoot(threadId),
    });
  } catch (error) {
    console.error("Failure capture error:", error);
    return null;
  }
}

export async function* agentEventsCore({
  message,
  threadId = "default",
  mode = "chat",
}) {
  const pendingPlanEvents = [];
  const composerMode = normalizeComposerMode(mode);
  const commandMode = composerMode === "command";
  const askMode = isAskComposerMode(composerMode);
  const appBuilderMode = isAppBuilderComposerMode(composerMode);

  const conversation = await getConversation(threadId, { createIfMissing: true });

  const { applyConversationWorkspaceToThread } = await import("./conversationWorkspace.js");
  await applyConversationWorkspaceToThread(threadId, conversation);

  const shellWaiting = isShellWaiting(threadId);

  addUiMessage(conversation, {
    role: "user",
    content: message,
    ...(commandMode || shellWaiting ? { command: true } : {}),
    ...(askMode ? { ask: true } : {}),
    ...(appBuilderMode ? { appBuilder: true } : {}),
    ...(shellWaiting ? { shellInput: true } : {}),
  });

  if (shellWaiting) {
    await saveConversation(conversation);

    yield {
      type: "status",
      phase: "shell-input",
      message: "Sending input to running command…",
    };

    let lastEvent = null;
    for await (const event of continueShellSession(threadId, message)) {
      if (event?.type === "error") throw new Error(event.error);
      lastEvent = event;
      if (event) yield event;
    }

    const session = getShellSession(threadId);
    const command = session?.command ?? "command";
    yield* yieldShellOutcome(conversation, threadId, lastEvent, command, {
      recordLlm: false,
    });
    return;
  }

  if (commandMode) {
    const direct = await runCommandMode(threadId, message);

    if (direct?.interactive) {
      yield {
        type: "status",
        phase: "command",
        message: `Running: ${direct.command}`,
      };

      yield* streamInteractiveShell(conversation, threadId, direct.command, {
        recordLlm: false,
      });
      return;
    }

    yield {
      type: "status",
      phase: "command",
      message: `Executing: ${message}`,
    };

    const workspaceEvent = await buildWorkspaceEvent(threadId);
    const toolEvents = direct.toolEvents ?? [];
    const workspaceEvents = [workspaceEvent];

    for (const event of toolEvents) yield event;
    yield workspaceEvent;

    addUiMessage(conversation, {
      role: "assistant",
      content: direct.reply,
      command: true,
    });
    conversation.cwd = getThreadCwd(threadId);

    const result = await finalizeResult({
      conversation,
      threadId,
      reply: direct.reply,
      toolEvents,
      workspaceEvents,
    });

    yield { type: "context", ...result.context };
    if (result.autoCompacted) yield { type: "auto_compact" };
    yield {
      type: "message",
      node: "agent",
      content: result.reply,
      cwd: result.cwd,
      workspace: result.workspace,
      conversationId: result.conversationId,
      direct: true,
    };
    return;
  }

  if (isCursorProvider()) {
    yield* streamCursorAgentTurn({
      message,
      threadId,
      conversation,
      askMode,
      composerMode,
    });
    return;
  }

  if (isWorkspaceLockRequest(message)) {
    const cwd = getThreadCwd(threadId);
    const { setConversationWorkspaceRoot, getConversationWorkspaceRoot } =
      await import("./conversationWorkspace.js");
    const setResult = await setConversationWorkspaceRoot(conversation, cwd, {
      source: "user",
    });
    void setResult;
    const root = getConversationWorkspaceRoot(conversation);
    const reply =
      root === "."
        ? `Conversation project set to workspace root. Use full paths (e.g. failure-test/package.json).`
        : `Conversation project root set to \`${root}\`. All tools stay under \`${root}/\`.`;

    addUiMessage(conversation, { role: "assistant", content: reply });
    conversation.cwd = getThreadCwd(threadId);

    const workspaceEvent = await buildWorkspaceEvent(threadId);
    const result = await finalizeResult({
      conversation,
      threadId,
      reply,
      toolEvents: [],
      workspaceEvents: [workspaceEvent],
    });

    yield { type: "context", ...result.context };
    if (result.autoCompacted) yield { type: "auto_compact" };
    yield workspaceEvent;
    yield {
      type: "message",
      node: "agent",
      content: reply,
      cwd: result.cwd,
      workspace: result.workspace,
      conversationId: result.conversationId,
      direct: true,
    };
    return;
  }

  if (askMode) {
    yield {
      type: "status",
      phase: "thinking",
      message: "Thinking…",
    };
  } else if (appBuilderMode) {
    yield {
      type: "status",
      phase: "app-builder",
      message: "App Builder — planning your app…",
    };
  } else {
    yield {
      type: "status",
      phase: "intent_assessment",
      message: "Assessing your request…",
    };
  }

  const intentContext = await buildIntentAssessmentContext(conversation, threadId);
  const turnIntent = askMode
    ? buildAskComposerTurnIntent()
    : appBuilderMode
      ? buildAppBuilderComposerTurnIntent()
      : await assessTurnIntent(message, intentContext);
  const { mentionsUserAppCreation } = await import("./userApps/userAppGuidance.js");
  const resolvedIntent =
    !askMode && !appBuilderMode && mentionsUserAppCreation(message)
      ? buildAppBuilderComposerTurnIntent()
      : turnIntent;
  setTurnIntent(threadId, resolvedIntent);
  const minimalChat = resolvedIntent.casualChat;
  const liteUi = minimalChat || askMode;
  const effectiveAppBuilder = appBuilderMode || resolvedIntent.profile === "appBuilder";
  const codingTurn = isCodingProfile(resolvedIntent) && !askMode && !effectiveAppBuilder;
  const stackProfile = liteUi
    ? askMode
      ? "research"
      : effectiveAppBuilder
        ? "appBuilder"
        : "chat"
    : resolveExecutionStackProfile(resolvedIntent.profile, message);
  const useTurnPacket =
    config.agent.loopV2 &&
    (codingTurn ||
      resolvedIntent.profile === "explore" ||
      stackProfile === "explore");

  yield {
    type: "turn_intent",
    profile: stackProfile,
    casualChat: resolvedIntent.casualChat,
    askMode,
    allowWebSearch: resolvedIntent.allowWebSearch,
    saveToMemory: resolvedIntent.saveToMemory ?? false,
    followUpProjectWork: resolvedIntent.followUpProjectWork ?? false,
    source: resolvedIntent.source,
    reason: resolvedIntent.reason,
    actionSummary: resolvedIntent.actionSummary,
  };

  if (resolvedIntent.workspaceMetaQuestion) {
    const reply = formatWorkspaceAnswer(threadId);
    addUiMessage(conversation, { role: "assistant", content: reply });
    conversation.cwd = getThreadCwd(threadId);

    const workspaceEvent = await buildWorkspaceEvent(threadId);
    const result = await finalizeResult({
      conversation,
      threadId,
      reply,
      toolEvents: [],
      workspaceEvents: [workspaceEvent],
    });

    yield { type: "context", ...result.context };
    if (result.autoCompacted) yield { type: "auto_compact" };
    yield workspaceEvent;
    yield {
      type: "message",
      node: "agent",
      content: reply,
      cwd: result.cwd,
      workspace: result.workspace,
      conversationId: result.conversationId,
      direct: true,
    };
    return;
  }

  const tools = createTools({
    threadId,
    turnIntent,
    askMode,
    onPlanEvent: (event) => pendingPlanEvents.push(event),
  });
  const toolByName = new Map(tools.map((t) => [t.name, t]));
  const knownToolNames = new Set(toolByName.keys());

  if (!minimalChat) {
    beginWebSearchTurn(threadId);
    clearBrainWebSearchState(threadId);
    setTurnResearchQuestion(threadId, message);
  }

  const retainTaskPlan = shouldRetainTaskPlanForTurn(message, turnIntent);
  if (!retainTaskPlan) {
    clearTaskPlan(threadId);
    await deleteExecutionPlan(threadId);
    yield { type: "plan", action: "clear", plan: null };
  }

  if (codingTurn) {
    clearTurnAwareness(threadId);
    clearAgentStepContextBrief(threadId);
    if (retainTaskPlan) {
      clearTaskPlan(threadId);
    }
    clearAcceptanceCriteria(threadId);
    clearHandoffBriefState(threadId);
    clearVerificationChecklist(threadId);
    clearTurnContext(threadId);
    clearFileContext(threadId);
    clearActions(threadId);
    const followUp = turnIntent.followUpProjectWork === true;
    if (followUp) {
      await deleteExecutionPlan(threadId);
      const fixPlan = await seedFollowUpFixPlan(
        threadId,
        message,
        getLockedProjectRoot(threadId),
      );
      yield emitPlanEvent(fixPlan, "create");
    } else if (shouldSkipPlanHydration(message, threadId)) {
      await deleteExecutionPlan(threadId);
    } else {
      const restoredPlan = await hydrateTaskPlanFromDisk(threadId);
      if (restoredPlan && isPlanComplete(threadId)) {
        clearTaskPlan(threadId);
        await deleteExecutionPlan(threadId);
      } else if (restoredPlan) {
        const reconciledPlan = await reopenStaleCompletedPlan(threadId, message);
        const activePlan = reconciledPlan ?? restoredPlan;
        if (activePlan) {
          yield emitPlanEvent(activePlan, reconciledPlan ? "update" : "restore");
        }
      }
    }
  }

  const mentionedProjects =
    codingTurn || turnIntent.profile === "explore"
      ? getFileContextState(threadId).mentionedProjects
      : [];

  const safeCwd = await initializeThreadWorkspace(threadId, {
    cwd: conversation.cwd ?? ".",
    userMessage: message,
    turnProfile: turnIntent.profile,
    conversation,
    mentionedProjects,
    skipHeavyInit: liteUi || isLiteProfile(turnIntent),
  });
  conversation.cwd = safeCwd;
  if (safeCwd && safeCwd !== ".") recordProjectHint(threadId, safeCwd);
  const activeAfterInit = getActiveProjectRoot(threadId);
  if (activeAfterInit) recordProjectHint(threadId, activeAfterInit);

  refreshSystemMessage(conversation, tools);
  maybeSetTitle(conversation, message);
  conversation.llmMessages.push({ role: "user", content: message });

  if (codingTurn) {
    const preflight = await runWorkspacePreflight(message, {
      lockedProjectRoot: getLockedProjectRoot(threadId),
      activeProjectRoot: getActiveProjectRoot(threadId),
      mentionedProjects,
    });
    beginTurnAwareness(threadId, preflight);
    markStackAwarenessPreflight(threadId, preflight);

    if (config.agent.loopV2) {
      initTurnContext(threadId, { preflight, userMessage: message, turnIntent });
      if (
        config.agent.acceptanceCriteriaEnabled &&
        !hasAcceptanceCriteria(threadId)
      ) {
        applyDeterministicAcceptanceCriteria(threadId, message, preflight);
      }
      if (isExplicitToolRunbook(message)) {
        patchTurnContext(threadId, {
          turnStartNote: "Direct tool runbook — honor SKIP rows; update_task_plan then execute.",
        });
      }
    } else {
      const awarenessContent = buildWorkspaceAwarenessBrief(preflight);
      conversation.llmMessages.push({
        role: "user",
        content: awarenessContent,
      });

      if (
        shouldSynthesizeAcceptanceCriteria({
          message,
          threadId,
          awarenessBrief: awarenessContent,
        })
      ) {
        let criteriaText = "";
        for await (const criteriaEvent of runAcceptanceCriteriaSynthesis({
          userMessage: message,
          threadId,
          awarenessBrief: awarenessContent,
        })) {
          yield criteriaEvent;
          if (criteriaEvent.type === "acceptance_criteria") {
            criteriaText = criteriaEvent.content ?? "";
          }
        }
        const criteriaInjection = formatAcceptanceCriteriaInjection(
          criteriaText,
          threadId,
        );
        if (criteriaInjection) {
          conversation.llmMessages.push({
            role: "user",
            content: criteriaInjection,
          });
        }
      }

      if (isExplicitToolRunbook(message)) {
        conversation.llmMessages.push({
          role: "user",
          content: buildExplicitToolRunbookBrief(),
        });
      }
    }
  }

  if (!minimalChat && isWebResearchQuestion(message)) {
    const brainHit = await preflightBrainForQuestion(threadId, message);
    if (brainHit) {
      setBrainSearchPreflight(threadId, message, brainHit);
      conversation.llmMessages.push({
        role: "user",
        content: buildBrainPreflightBrief(brainHit, message),
      });
    }
  }

  if (!isLiteProfile(turnIntent) && !askMode && !config.agent.loopV2) {
    const intentBrief = buildIntentAssessmentBrief(turnIntent);
    if (intentBrief) {
      conversation.llmMessages.push({ role: "user", content: intentBrief });
    }
  }

  if (!liteUi) {
    clearExecutionStack(threadId);
    initExecutionStack(threadId, stackProfile);

    if (
      codingTurn ||
      turnIntent.profile === "explore" ||
      stackProfile === "explore"
    ) {
      try {
        const fileMap = await ensureWorkspaceFileMap(threadId);
        if (fileMap.paths.length) {
          if (!useTurnPacket) {
            conversation.llmMessages.push({
              role: "user",
              content: formatWorkspaceFileMapBrief(fileMap),
            });
          }
          markStackExploreIndexed(threadId, fileMap);
        }
      } catch (error) {
        console.warn("[workspaceFileMap]", error?.message ?? error);
      }
    }

    yield* yieldStack(threadId);
  }

  if (codingTurn) {
    yield {
      type: "status",
      phase: "init",
      message: "Loading conversation context…",
    };
  }

  await activateConversation(threadId);

  if (codingTurn && isProjectTask(message)) {
    const reconciledPlan = getTaskPlan(threadId);
    if (config.agent.loopV2) {
      const notes = [];
      if (
        reconciledPlan &&
        userIndicatesStalePlan(message) &&
        !isPlanComplete(threadId)
      ) {
        notes.push(buildStalePlanReopenBrief(reconciledPlan, message));
      }
      if (isFollowUpProjectTurn(threadId)) {
        notes.push(
          buildFixFollowUpBrief(message, getLockedProjectRoot(threadId)),
        );
      }
      notes.push(buildTurnStartExecutionBrief(message, threadId));
      patchTurnContext(threadId, { turnStartNote: notes.join("\n") });
    } else {
      if (
        reconciledPlan &&
        userIndicatesStalePlan(message) &&
        !isPlanComplete(threadId)
      ) {
        conversation.llmMessages.push({
          role: "user",
          content: buildStalePlanReopenBrief(reconciledPlan, message),
        });
      }
      if (isFollowUpProjectTurn(threadId)) {
        conversation.llmMessages.push({
          role: "user",
          content: buildFixFollowUpBrief(message, getLockedProjectRoot(threadId)),
        });
      }
      conversation.llmMessages.push({
        role: "user",
        content: buildTurnStartExecutionBrief(message, threadId),
      });
    }
    const phase = getExecutionPhase(message, [], threadId);
    yield {
      type: "status",
      phase:
        phase === "research"
          ? "research"
          : phase === "awareness"
            ? "awareness"
            : phase === "plan"
              ? "plan"
              : "execute",
      message:
        phase === "research"
          ? "Phase 0: web_search required before other tools…"
          : phase === "awareness"
            ? "Phase 1: check workspace (EXISTS/MISSING) before planning…"
            : phase === "plan"
              ? "Phase 2: create task plan before executing…"
              : "Phase 3: executing task plan…",
    };
  }

  const toolEvents = [];
  const workspaceEvents = [];
  const reasoningSteps = [];
  let blockedNoToolSteps = 0; // consecutive steps where model produced no tool call but was blocked
  let markPlanStepBlockCount = 0;
  let planStepLoopBriefInjected = false;
  let prematureHandoffCount = 0;
  let updateTaskPlanSchemaFailCount = 0;

  for (let step = 0; step < MAX_AGENT_STEPS; step++) {
    refreshSystemMessage(conversation, tools);

    if (useTurnPacket) {
      pruneStaleBriefs(conversation);
      const budget = await ensureContextBudget(threadId);
      if (!budget.ok) {
        yield {
          type: "error",
          message: budget.error ?? "Context exceeds provider token cap.",
        };
        return;
      }
      const packet = await buildTurnPacket(threadId, {
        step,
        maxSteps: MAX_AGENT_STEPS,
        userMessage: message,
        toolEvents,
      });
      pushTurnPacket(conversation, packet);
    } else if (codingTurn) {
      const stepBrief = await buildAgentStepContextBrief(threadId, {
        toolEvents,
        step,
      });
      if (stepBrief) {
        conversation.llmMessages.push({ role: "user", content: stepBrief });
      }
    }

    if (!useTurnPacket) {
      if (codingTurn && step > 0 && isPlanFrozen(threadId)) {
        const commit = buildExecutionCommitBrief(threadId);
        if (commit) {
          conversation.llmMessages.push({ role: "user", content: commit });
        }
      } else if (
        codingTurn &&
        step > 0 &&
        shouldRunVerificationPlanning({ toolEvents, message, threadId })
      ) {
        let verificationPlanText = "";
        for await (const planEvent of runVerificationPlanningPhase({
          userMessage: message,
          toolEvents,
          threadId,
          step,
        })) {
          if (planEvent.type === "verification_plan") {
            verificationPlanText = planEvent.content ?? "";
          }
          yield planEvent;
        }

        const injection = formatVerificationPlanInjection(
          verificationPlanText,
          threadId,
        );
        if (injection) {
          conversation.llmMessages.push({
            role: "user",
            content: injection,
          });
        }
      } else if (
        codingTurn &&
        step > 0 &&
        shouldRunNextMovePlanning({ toolEvents, message, threadId })
      ) {
        let nextMovePlan = "";
        for await (const planEvent of runNextMovePlanningPhase({
          userMessage: message,
          toolEvents,
          threadId,
          step,
        })) {
          if (planEvent.type === "planning") {
            nextMovePlan = planEvent.content ?? "";
          }
          yield planEvent;
        }

        const injection = formatNextMovePlanInjection(nextMovePlan, step + 1);
        if (injection) {
          conversation.llmMessages.push({
            role: "user",
            content: injection,
          });
        }
      }
    }

    if (
      shouldInjectHandoffBrief({
        toolEvents,
        threadId,
        userMessage: message,
        step,
      })
    ) {
      conversation.llmMessages.push({
        role: "user",
        content: buildHandoffBrief({ userMessage: message, threadId }),
      });
      markHandoffBriefInjected(threadId);
    }

    const messages = await resolveLlmMessages(conversation);

    if (!minimalChat) {
      yield {
        type: "status",
        phase: "thinking",
        step: step + 1,
        message: `Jarvis is thinking… (step ${step + 1})`,
      };
    }

    let assistantMessage;
    let reasoning = "";
    let streamedContent = false;
    let streamedReasoning = false;
    let streamedAssistantBuffer = "";

    const suppressNarration = shouldSuppressStreamNarration({
      minimalChat,
      threadId,
      toolEvents,
      message,
    });
    const suppressReasoningStream = shouldSuppressStreamReasoning({
      minimalChat,
      threadId,
      toolEvents,
      message,
    });

    transcriptLog.record(threadId, "llm_request", {
      step: step + 1,
      model: config.llm.model,
      baseURL: config.llm.baseURL,
      messageCount: messages.length,
      messages,
    });

    let modelUsage = {};

    for await (const streamEvent of streamModel(messages, {
      minimalChat,
      step,
      suppressReasoningStream,
    })) {
      if (streamEvent.type === "model_done") {
        assistantMessage = streamEvent.message;
        reasoning = streamEvent.reasoning ?? "";
        streamedContent = streamEvent.streamedContent;
        modelUsage = streamEvent.usage ?? {};
        continue;
      }

      if (streamEvent.type === "reasoning_delta") {
        streamedReasoning = true;
        const existing = reasoningSteps.find((r) => r.step === streamEvent.step);
        if (existing) {
          existing.content += streamEvent.content;
        } else {
          reasoningSteps.push({
            step: streamEvent.step,
            content: streamEvent.content,
          });
        }
        if (!minimalChat) {
          markStackThinking(threadId, streamEvent.step, "");
        }
        yield streamEvent;
        continue;
      }

      if (streamEvent.type === "message_delta") {
        streamedAssistantBuffer += streamEvent.content;
        if (
          suppressNarration ||
          shouldSuppressGemmaToolCallStream(streamedAssistantBuffer)
        ) {
          continue;
        }
      }

      yield streamEvent;
    }

    transcriptLog.record(threadId, "llm_response", {
      step: step + 1,
      model: config.llm.model,
      assistantMessage,
      reasoning,
      usage: modelUsage,
      streamedContent,
      streamedReasoning,
    });

    if (reasoning && !minimalChat && !streamedReasoning) {
      if (!reasoningSteps.some((r) => r.content === reasoning)) {
        reasoningSteps.push({ step: step + 1, content: reasoning });
      }
      markStackThinking(threadId, step + 1, "");
      yield { type: "reasoning", step: step + 1, content: reasoning };
      yield* yieldStack(threadId);
    } else if (reasoning && !minimalChat && streamedReasoning) {
      const stepEntry = reasoningSteps.find((r) => r.step === step + 1);
      if (stepEntry && stepEntry.content !== reasoning) {
        stepEntry.content = reasoning;
      }
      yield {
        type: "reasoning",
        step: step + 1,
        content: stepEntry?.content ?? reasoning,
        finalize: true,
      };
      markStackThinkingDone(threadId);
    } else {
      markStackThinkingDone(threadId);
    }
    conversation.llmMessages.push(serializeAssistantMessage(assistantMessage));

    let toolRequests = extractToolRequests(assistantMessage, knownToolNames);

    if (toolRequests.length && streamedContent) {
      yield { type: "stream_end", retract: true };
    }

    if (!toolRequests.length) {
      const reply = assistantMessage.content ?? "";

      if (!minimalChat) {
      if (webResearchRequiredForTurn(threadId, toolEvents, message)) {
        const activeProject = getActiveProjectRoot(threadId);
        yield {
          type: "status",
          phase: "research",
          message: "Searching for latest conventions before coding…",
        };
        conversation.llmMessages.push({
          role: "user",
          content: buildWebResearchRetryMessage(message, {
            activeProject,
            projectType: null,
          }),
        });
        continue;
      }

      if (shouldForceWebSearch(message, reply, toolEvents, threadId)) {
        yield {
          type: "status",
          phase: "search",
          message: "Needs web search — retrying with search…",
        };
        conversation.llmMessages.push({
          role: "user",
          content:
            "Do not answer that you lack information yet. Call web_search now with a focused query, then answer using those results. Do not mention tool failures from earlier turns — try web_search again.",
        });
        continue;
      }

      if (shouldForceWebSearchAfterEmptyRecall(message, reply, toolEvents, threadId)) {
        yield {
          type: "status",
          phase: "search",
          message: "Memory miss — searching the web…",
        };
        conversation.llmMessages.push({
          role: "user",
          content:
            "Brain recall did not contain the requested facts. Use web_search now with a focused query and answer from the results. Do not ask Jan for permission to search.",
        });
        continue;
      }

      if (
        shouldForceWebSearchFollowUp(
          message,
          reply,
          toolEvents,
          conversation,
          threadId,
        )
      ) {
        yield {
          type: "status",
          phase: "search",
          message: "Extracting answer from search results…",
        };
        conversation.llmMessages.push({
          role: "user",
          content: buildWebSearchFollowUpNudge(message, toolEvents, threadId),
        });
        continue;
      }

      if (
        shouldForceWebSearchCitations(
          message,
          reply,
          toolEvents,
          conversation,
          threadId,
        )
      ) {
        const sources = getWebSearchSourcesFromEvents(toolEvents);
        yield {
          type: "status",
          phase: "cite",
          message: "Adding source citations…",
        };
        conversation.llmMessages.push({
          role: "user",
          content: buildWebSearchCitationNudge(sources),
        });
        continue;
      }

      if (shouldForceRemember(message, reply, toolEvents, threadId)) {
        yield {
          type: "status",
          phase: "remember",
          message: "Saving to core memory…",
        };
        conversation.llmMessages.push({
          role: "user",
          content:
            "Master Jan asked you to save this to your brain/core memory. " +
            "You must call the remember tool now with title and content summarizing what you learned " +
            "(include key facts from web_search if you used it). " +
            "Do not reply in plain text or claim you saved anything until remember succeeds.",
        });
        continue;
      }

      if (shouldForcePlanning(message, reply, toolEvents, threadId)) {
        yield {
          type: "status",
          phase: "plan",
          message: "Creating task checklist…",
        };
        conversation.llmMessages.push({
          role: "user",
          content:
            "Phase 2 PLAN — web_search is done. " +
            "Call update_task_plan NOW with a numbered checklist (≥2 steps, final step = verify). " +
            "The server blocks run_bash, write_file, and read_file until the plan exists. " +
            "Then execute each step in order; tool results show STATUS: SUCCESS or STATUS: FAIL.",
        });
        continue;
      }

      const phantomWrite = claimedWriteWithoutTool(toolEvents, reply, reasoning);

      if (phantomWrite) {
        yield {
          type: "status",
          phase: "tools",
          message: "Must call write_file — plain text does not create files…",
        };
        conversation.llmMessages.push({
          role: "user",
          content:
            "You claimed a file was written but write_file did not succeed in this turn. " +
            "Plain text does not create files — call write_file with the full file content for each file.",
        });
        continue;
      }

      if (
        isPrematureHandoffReply(reply, toolEvents) ||
        (isEchoingInjectedBrief(reply) &&
          hasValidPlan(threadId) &&
          !isPlanComplete(threadId))
      ) {
        prematureHandoffCount++;
        const current = getCurrentPlanStep(threadId);
        const written = getWrittenPaths(toolEvents);
        yield {
          type: "status",
          phase: "execute",
          message: "Must execute locked plan step — do not hand off yet…",
        };
        conversation.llmMessages.push({
          role: "user",
          content: buildExecuteLockedStepNudge(current, written),
        });
        continue;
      }

      if (claimedHandoffWithUnwrittenFiles(toolEvents, reply, reasoning)) {
        yield {
          type: "status",
          phase: "tools",
          message: "Handoff blocked — claimed files missing on disk…",
        };
        conversation.llmMessages.push({
          role: "user",
          content: buildHandoffIncompleteNudge(toolEvents, reply, reasoning),
        });
        continue;
      }

      if (shouldForceCodebaseInspect(message, reply, toolEvents, threadId)) {
        yield {
          type: "status",
          phase: "inspect",
          message: "Inspecting codebase…",
        };
        conversation.llmMessages.push({
          role: "user",
          content:
            "Call inspect_codebase to confirm project root and entry files before editing. " +
            "Use full workspace-relative paths from the active project.",
        });
        continue;
      }

      if (shouldForceCodebaseSearch(message, reply, toolEvents)) {
        yield {
          type: "status",
          phase: "grep",
          message: "Searching codebase before edits…",
        };
        conversation.llmMessages.push({
          role: "user",
          content:
            "Before editing, explore the codebase: call semantic_search (concepts), grep_code (exact symbols), or glob_files to find relevant files, " +
            "or inspect_codebase + inspect_ast. Do not write code from memory — locate the real files first.",
        });
        continue;
      }

      if (shouldVerifyAfterWrite(message, reply, toolEvents, threadId)) {
        yield {
          type: "status",
          phase: "verify",
          message: "Verifying file paths and changes…",
        };
        const activeRoot = getActiveProjectRoot(threadId) ?? getThreadCwd(threadId);
        const lastPath = getWrittenPaths(toolEvents).at(-1);
        const pathIssue = hasUnresolvedPathWarnings(toolEvents);
        conversation.llmMessages.push({
          role: "user",
          content: pathIssue
            ? `File path error detected (see PATH REJECTED or WARNING in tool results). ` +
              `Active project is "${activeRoot}". ` +
              `Call inspect_codebase, then rewrite using the full project prefix ` +
              `(e.g. "${activeRoot === "." ? "my-app" : activeRoot}/src/..."). ` +
              `Do not invent paths — reuse paths from inspect_codebase and read_file results.`
            : `After write_file you must confirm the change saved correctly. ` +
              (lastPath
                ? `Call read_file on "${lastPath}" to confirm the change, fix any issues with write_file, then verify_project.`
                : "Then call verify_project before handing off."),
        });
        continue;
      }

      if (shouldForcePathCorrection(message, reply, toolEvents)) {
        yield {
          type: "status",
          phase: "path",
          message: "Correcting file paths…",
        };
        conversation.llmMessages.push({
          role: "user",
          content:
            "Your last write used the WRONG directory (see PATH REJECTED / WARNING). " +
            "Call inspect_codebase to confirm project root. " +
            "Only use paths listed in File location memory — never guess src/ at workspace root.",
        });
        continue;
      }

      if (shouldForceInspectBeforeWrite(message, toolEvents, threadId)) {
        yield {
          type: "status",
          phase: "inspect",
          message: "Must inspect codebase before writing…",
        };
        conversation.llmMessages.push({
          role: "user",
          content:
            "You wrote files without establishing project context. " +
            "Call inspect_codebase NOW before any more write_file calls.",
        });
        continue;
      }

      if (shouldForceReadBeforeFixOnVerifyFail(toolEvents)) {
        const lastVerify = getLastVerifyResult(toolEvents);
        const { files } = extractVerificationErrors(lastVerify?.content ?? "");
        yield {
          type: "status",
          phase: "debug",
          message: "Must read error files before editing…",
        };
        conversation.llmMessages.push({
          role: "user",
          content:
            "verify_project failed. You tried to edit without reading the cited error files.\n" +
            (files.length
              ? `Call inspect_ast on: ${files.map((f) => `"${f}"`).join(", ")} first; read_file if AST lacks error-line context.\n`
              : "") +
            "Then fix with write_file/search_replace — reuse AST context; do not re-read whole files.",
        });
        continue;
      }

      if (shouldForceErrorFix(message, reply, toolEvents)) {
        yield {
          type: "status",
          phase: "debug",
          message: "Build/runtime error reported — investigating…",
        };
        const cited = extractErrorFilePath(message);
        conversation.llmMessages.push({
          role: "user",
          content:
            "Master Jan reported the app is broken or pasted a build/runtime error. " +
            "Do NOT claim the code is correct, blame the environment, or ask him to run commands manually. " +
            (cited
              ? `Start with inspect_ast on "${cited}" (or the file path from the error); read_file if AST is insufficient. `
              : "Start with inspect_ast on the file cited in the error; read_file only if you need exact source for the fix. ") +
            "Fix with write_file, then run_bash with the project's build, test, or dev command to verify. " +
            "Only reply in plain text after tool results show success.",
        });
        continue;
      }

      if (shouldForceToolUse(message, reply, toolEvents)) {
        yield {
          type: "status",
          phase: "tools",
          message: "Must use tools — retrying…",
        };
        conversation.llmMessages.push({
          role: "user",
          content:
            "You must use tools now — do not describe what you would do. " +
            "Call inspect_codebase and/or inspect_ast, then write_file or run_bash as needed.",
        });
        continue;
      }

      if (webResearchRequiredForTurn(threadId, toolEvents, message)) {
        yield {
          type: "status",
          phase: "research",
          message: "Must web_search before handing off…",
        };
        conversation.llmMessages.push({
          role: "user",
          content: buildWebResearchRetryMessage(message, {
            activeProject: getActiveProjectRoot(threadId),
          }),
        });
        continue;
      }

      const completionCheck = blockedNoToolSteps < 3
        ? await assessCompletionReadiness({
            userMessage: message,
            reply,
            toolEvents,
            threadId,
            isProjectTask: isProjectTask(message),
            hasValidPlan,
            isPlanComplete,
            getIncompleteSteps,
            getActiveProjectRoot,
          })
        : { block: false }; // model has given up on tools — let it finish

      if (completionCheck.block) {
        blockedNoToolSteps++;
        yield {
          type: "status",
          phase: completionCheck.phase ?? "verify",
          message: completionCheck.statusMessage,
        };
        yield {
          type: "verification",
          status: "blocked",
          reason: completionCheck.reason,
        };
        const planBlock = planStatusBlock(threadId);
        conversation.llmMessages.push({
          role: "user",
          content:
            completionCheck.retryMessage +
            (planBlock ? `\n\n${planBlock}` : ""),
        });
        continue;
      }
      } else if (shouldForceRemember(message, reply, toolEvents, threadId)) {
        yield {
          type: "status",
          phase: "remember",
          message: "Saving to core memory…",
        };
        conversation.llmMessages.push({
          role: "user",
          content:
            "Master Jan asked you to save this to your brain/core memory. " +
            "You must call the remember tool now with title and content summarizing what you learned. " +
            "Do not reply in plain text or claim you saved anything until remember succeeds.",
        });
        continue;
      }

      for (const planEvent of drainPlanEvents(pendingPlanEvents)) {
        yield planEvent;
      }

      const turnReasoning = reasoningSteps.length
        ? reasoningSteps.map((r) => r.content).join("\n\n---\n\n")
        : undefined;

      addUiMessage(conversation, {
        role: "assistant",
        content: reply,
        ...(turnReasoning ? { reasoning: turnReasoning } : {}),
        ...(serializeTaskPlan(threadId)
          ? { taskPlan: serializeTaskPlan(threadId) }
          : {}),
      });
      if (!minimalChat) {
        const workspaceEvent = await buildWorkspaceEvent(threadId);
        workspaceEvents.push(workspaceEvent);
        yield workspaceEvent;
      }

      const autoSaved = await autoSaveWebSearchToBrain({
        threadId,
        userMessage: message,
        reply,
        toolEvents,
      });
      if (autoSaved) {
        yield {
          type: "auto_reflect",
          saved: { memories: 1, skills: 0 },
          source: "web-search",
          title: autoSaved.title,
        };
      }

      const result = await finalizeResult({
        conversation,
        threadId,
        reply,
        toolEvents,
        workspaceEvents,
        casualChat: minimalChat,
      });

      yield* yieldChatFinish(result, {
        threadId,
        toolEvents,
        userMessage: message,
        reasoning: turnReasoning,
      });
      return;
    }

    const toolGroups = groupToolRequests(toolRequests);

    toolGroupsLoop:
    for (const toolGroup of toolGroups) {
      if (
        toolGroup.type === "parallel" &&
        config.toolParallel.enabled &&
        toolGroup.requests.length > 1
      ) {
        const batchResult = yield* runParallelReadOnlyBatch(toolGroup.requests, {
          threadId,
          message,
          conversation,
          step,
          toolEvents,
          workspaceEvents,
          pendingPlanEvents,
          retainTaskPlan,
          minimalChat,
          toolByName,
          knownToolNames,
          tools,
        });
        if (batchResult?.abortTurn) break toolGroupsLoop;
        blockedNoToolSteps = 0;
        continue;
      }

      nextToolInGroup:
      for (const initialToolRequest of toolGroup.requests) {
        let toolRequest = initialToolRequest;
        let tool = toolByName.get(toolRequest.name);

    if (isAskModeTurn(threadId) && !ASK_MODE_TOOLS.has(toolRequest.name)) {
      const blockedCall = {
        type: "tool_call",
        name: toolRequest.name,
        args: toolRequest.args ?? {},
      };
      toolEvents.push(blockedCall);
      yield blockedCall;
      const skip = askModeSkipMessage();
      const resultEvent = {
        type: "tool_result",
        name: toolRequest.name,
        content: skip,
      };
      toolEvents.push(resultEvent);
      yield resultEvent;
      conversation.llmMessages.push({
        role: "user",
        content: skip,
      });
      continue nextToolInGroup;
    }

    const turnIntent = getTurnIntent(threadId);
    if (
      turnIntent?.casualChat &&
      !CASUAL_CHAT_TOOLS.has(toolRequest.name)
    ) {
      const blockedCall = {
        type: "tool_call",
        name: toolRequest.name,
        args: toolRequest.args ?? {},
      };
      toolEvents.push(blockedCall);
      yield blockedCall;
      const skip = casualChatSkipMessage();
      const resultEvent = {
        type: "tool_result",
        name: toolRequest.name,
        content: skip,
      };
      toolEvents.push(resultEvent);
      yield resultEvent;
      conversation.llmMessages.push({
        role: "user",
        content: skip,
      });
      continue nextToolInGroup;
    }

    const executionGate = checkExecutionGate(toolRequest.name, {
      message,
      toolEvents,
      threadId,
    });
    if (executionGate.blocked) {
      const blockedCall = {
        type: "tool_call",
        name: toolRequest.name,
        args: toolRequest.args ?? {},
      };
      toolEvents.push(blockedCall);
      yield blockedCall;
      const gatedContent = appendToolStatus(
        toolRequest.name,
        executionGate.message ?? "Tool blocked — wrong execution phase.",
      );
      const resultEvent = {
        type: "tool_result",
        name: toolRequest.name,
        content: gatedContent,
      };
      toolEvents.push(resultEvent);
      yield resultEvent;
      conversation.llmMessages.push({
        role: "user",
        content:
          executionGate.phase === "research"
            ? buildWebResearchRetryMessage(message, {
                activeProject: getActiveProjectRoot(threadId),
              })
            : `Tool error: ${executionGate.message}`,
      });
      continue nextToolInGroup;
    }

    if (toolRequest.name === "web_search" && isWebSearchLimitReached(threadId)) {
      conversation.llmMessages.push({
        role: "user",
        content: buildWebSearchFollowUpNudge(message, toolEvents, threadId),
      });
      break toolGroupsLoop;
    }

    let normalizedArgs;
    try {
      const resolved = await resolveToolArgs(
        toolRequest.name,
        toolRequest.args,
        threadId,
        message,
      );
      normalizedArgs = sanitizeToolArgs(toolRequest.name, resolved);

      if (toolRequest.name === "mark_plan_step") {
        normalizedArgs = inferMarkPlanStepDefaults(threadId, normalizedArgs);
      }

      if (toolRequest.name === "update_task_plan") {
        const coerced = normalizeUpdateTaskPlanArgs(normalizedArgs);
        if (!coerced) {
          throw new Error(buildUpdateTaskPlanSchemaError());
        }
        normalizedArgs = coerced;
      }

      if (toolRequest.name === "run_bash") {
        const inferred = inferRunBashCommand(normalizedArgs);
        if (inferred && !String(normalizedArgs.command ?? "").trim()) {
          normalizedArgs = { ...normalizedArgs, command: inferred };
        }
        const cmd = String(normalizedArgs.command ?? "").trim();
        if (!cmd) {
          throw new Error(
            "run_bash requires a command string. Received only cwd or empty args.\n" +
              'Example: {"tool":"run_bash","args":{"command":"mkdir -p my-app && npm init -y","cwd":"my-app"}}\n' +
              "Do NOT pass only cwd — always include command.",
          );
        }
        const interactive = analyzeBashCommand(cmd);
        if (interactive.blocked) {
          throw new Error(formatInteractiveBlockMessage(interactive));
        }
        const { isExternalAppServerCommand, shouldUseVisionOsAppPipeline, externalAppServerBlockMessage } =
          await import("./userApps/appCreationPolicy.js");
        if (
          isExternalAppServerCommand(cmd) &&
          shouldUseVisionOsAppPipeline(threadId, message, getTurnIntent)
        ) {
          throw new Error(externalAppServerBlockMessage());
        }
      }

      if (toolRequest.name === "mark_plan_step") {
        if (!normalizedArgs.step_id || !normalizedArgs.status) {
          const current = getCurrentPlanStep(threadId);
          const stepHint = current?.id
            ? `Active step is "${current.id}" — `
            : "";
          throw new Error(
            `${stepHint}mark_plan_step requires step_id and status.\n` +
              `Example: {"tool":"mark_plan_step","args":${describeToolSchema("mark_plan_step")}}`,
          );
        }
      }
    } catch (error) {
      const errMsg = String(error?.message ?? error);
      const isArgsValidation =
        toolRequest.name === "mark_plan_step" ||
        toolRequest.name === "run_bash" ||
        /requires step_id|requires a command string/i.test(errMsg);
      const prefix = isArgsValidation ? "Invalid tool args" : "Path resolution error";
      const msg = `${prefix}: ${errMsg}`;
      const resultEvent = {
        type: "tool_result",
        name: toolRequest.name,
        content: msg,
      };
      toolEvents.push(resultEvent);
      yield resultEvent;
      await captureFailureFromToolResult({
        threadId,
        userMessage: message,
        toolName: toolRequest.name,
        toolArgs: toolRequest.args ?? {},
        toolResultContent: resultEvent.content,
        toolEvents,
      });
      conversation.llmMessages.push({
        role: "user",
        content: `Tool error: ${msg}`,
      });
      continue nextToolInGroup;
    }

    const fsGate = await checkFilesystemAwarenessGate(
      toolRequest.name,
      normalizedArgs,
      { threadId, getTurnAwareness, getLockedProjectRoot },
    );
    if (
      toolRequest.name === "write_file" &&
      normalizedArgs?.path &&
      shouldBlockGreenfieldRootWrite(
        message,
        normalizedArgs.path,
        getTurnAwareness(threadId)?.preflight,
      )
    ) {
      const blockedCall = {
        type: "tool_call",
        name: toolRequest.name,
        args: normalizedArgs,
      };
      toolEvents.push(blockedCall);
      yield blockedCall;
      const body = buildGreenfieldRootWriteBlockedMessage(normalizedArgs.path);
      const gatedContent = formatHardBlockedToolResult(toolRequest.name, {
        title: `${toolRequest.name} blocked — use a project subfolder`,
        why: body.split("\n")[0],
        next:
          "run_bash mkdir -p <project-folder> then write_file <project-folder>/<filename> with full content.",
      });
      const resultEvent = attachResultSummary(
        {
          type: "tool_result",
          name: toolRequest.name,
          content: gatedContent,
        },
        gatedContent,
      );
      toolEvents.push(resultEvent);
      yield resultEvent;
      conversation.llmMessages.push({ role: "user", content: gatedContent });
      continue nextToolInGroup;
    }
    if (fsGate.blocked) {
      const blockedCall = {
        type: "tool_call",
        name: toolRequest.name,
        args: normalizedArgs,
      };
      toolEvents.push(blockedCall);
      yield blockedCall;
      const fsGateBody = fsGate.statusLine
        ? `${fsGate.statusLine}\n${fsGate.message ?? ""}`
        : (fsGate.message ?? "Tool skipped — filesystem awareness.");
      const gatedContent = appendToolStatus(toolRequest.name, fsGateBody);
      const resultEvent = {
        type: "tool_result",
        name: toolRequest.name,
        content: gatedContent,
      };
      toolEvents.push(resultEvent);
      yield resultEvent;
      conversation.llmMessages.push({
        role: "user",
        content: fsGate.message ?? "Filesystem awareness skip.",
      });
      continue nextToolInGroup;
    }

    if (isBlockedEditWithoutReadOnVerifyFail(toolRequest.name, toolEvents)) {
      const req = getVerifyFailReadRequirement(toolEvents);
      const error =
        "verify_project failed — read the cited error files before editing.";
      const blockedCall = {
        type: "tool_call",
        name: toolRequest.name,
        args: toolRequest.args ?? {},
      };
      toolEvents.push(blockedCall);
      yield blockedCall;
      const resultEvent = {
        type: "tool_result",
        name: toolRequest.name,
        content:
          `${error}\n` +
          (req?.files?.length
            ? `Call inspect_ast on: ${req.files.map((f) => `"${f}"`).join(", ")}; read_file if AST lacks context`
            : "Call inspect_ast on files cited in verify output; read_file only if exact source needed for fix."),
      };
      toolEvents.push(resultEvent);
      yield resultEvent;
      conversation.llmMessages.push({
        role: "user",
        content: `Tool error: ${error}`,
      });
      continue nextToolInGroup;
    }

    const pathSearchBlock = pathSearchBlockMessage(
      toolRequest.name,
      normalizedArgs,
      toolEvents,
    );
    if (pathSearchBlock) {
      const blockedCall = {
        type: "tool_call",
        name: toolRequest.name,
        args: normalizedArgs,
      };
      toolEvents.push(blockedCall);
      yield blockedCall;
      const resultEvent = {
        type: "tool_result",
        name: toolRequest.name,
        content: pathSearchBlock,
      };
      toolEvents.push(resultEvent);
      yield resultEvent;
      conversation.llmMessages.push({
        role: "user",
        content: `Tool error: ${pathSearchBlock}`,
      });
      continue nextToolInGroup;
    }

    const astRedirect = detectAstReadRedirect(
      toolRequest.name,
      normalizedArgs,
      toolEvents,
      { codingTurn: !minimalChat },
    );
    if (astRedirect) {
      if (!config.astReadGate.redirectToInspect) {
        const gateMsg = buildReadFileGateMessage(astRedirect.path);
        const blockedCall = {
          type: "tool_call",
          name: toolRequest.name,
          args: normalizedArgs ?? {},
        };
        toolEvents.push(blockedCall);
        yield blockedCall;
        const gatedContent = appendToolStatus(toolRequest.name, gateMsg);
        const resultEvent = {
          type: "tool_result",
          name: toolRequest.name,
          content: gatedContent,
        };
        toolEvents.push(resultEvent);
        yield resultEvent;
        conversation.llmMessages.push({
          role: "user",
          content: gateMsg,
        });
        continue nextToolInGroup;
      }

      conversation.llmMessages.push({
        role: "user",
        content: astRedirect.message,
      });
      toolRequest = { name: "inspect_ast", args: astRedirect.inspectArgs };
      try {
        const resolved = await resolveToolArgs(
          "inspect_ast",
          astRedirect.inspectArgs,
          threadId,
          message,
        );
        normalizedArgs = sanitizeToolArgs("inspect_ast", resolved);
        tool = toolByName.get("inspect_ast");
      } catch (error) {
        const msg = `AST redirect error: ${error.message}`;
        const resultEvent = {
          type: "tool_result",
          name: "inspect_ast",
          content: msg,
        };
        toolEvents.push(resultEvent);
        yield resultEvent;
        conversation.llmMessages.push({
          role: "user",
          content: `Tool error: ${msg}`,
        });
        continue nextToolInGroup;
      }
    }

    if (isBlockedWithoutExploration(toolRequest.name, message, toolEvents, threadId)) {
      const gatedContent = formatHardBlockedToolResult(toolRequest.name, {
        title: `${toolRequest.name} blocked — workspace exploration required`,
        why:
          "No read-only exploration tool succeeded this turn and Phase 1 awareness is not satisfied.",
        next:
          "Call list_directory, inspect_codebase, or search_files once — then retry write_file with full file content.",
      });
      const blockedCall = {
        type: "tool_call",
        name: toolRequest.name,
        args: normalizedArgs ?? toolRequest.args ?? {},
      };
      toolEvents.push(blockedCall);
      yield blockedCall;
      const resultEvent = attachResultSummary(
        {
          type: "tool_result",
          name: toolRequest.name,
          content: gatedContent,
        },
        gatedContent,
        normalizedArgs ?? {},
      );
      toolEvents.push(resultEvent);
      yield resultEvent;
      conversation.llmMessages.push({
        role: "user",
        content: `Tool error:\n${gatedContent}`,
      });
      continue nextToolInGroup;
    }

    if (
      isBlockedWithoutProjectContext(
        toolRequest.name,
        message,
        threadId,
        toolEvents,
      )
    ) {
      const gatedContent = formatHardBlockedToolResult(toolRequest.name, {
        title: `${toolRequest.name} blocked — no project root locked`,
        why:
          "Active project root is workspace \".\" and inspect_codebase has not run this turn.",
        next: GREENFIELD_NO_ROOT_LOCK_HINT,
      });
      const blockedCall = {
        type: "tool_call",
        name: toolRequest.name,
        args: normalizedArgs ?? toolRequest.args ?? {},
      };
      toolEvents.push(blockedCall);
      yield blockedCall;
      const resultEvent = attachResultSummary(
        {
          type: "tool_result",
          name: toolRequest.name,
          content: gatedContent,
        },
        gatedContent,
        normalizedArgs ?? {},
      );
      toolEvents.push(resultEvent);
      yield resultEvent;
      await captureFailureFromToolResult({
        threadId,
        userMessage: message,
        toolName: toolRequest.name,
        toolArgs: toolRequest.args ?? {},
        toolResultContent: resultEvent.content,
        toolEvents,
      });
      conversation.llmMessages.push({
        role: "user",
        content: `Tool error:\n${gatedContent}`,
      });
      continue nextToolInGroup;
    }

    if (toolRequest.name === "mark_plan_step") {
      if (markPlanStepBlockCount >= 3) {
        const current = getCurrentPlanStep(threadId);
        const gatedContent = formatHardBlockedToolResult(toolRequest.name, {
          title: `${toolRequest.name} blocked — step work required first`,
          why: "Repeated mark_plan_step calls without successful tool evidence on the active step.",
          next: current
            ? `Complete the step: ${current.label}`
            : "Call run_bash or write_file before updating plan step status.",
        });
        const blockedCall = {
          type: "tool_call",
          name: toolRequest.name,
          args: normalizedArgs ?? toolRequest.args ?? {},
        };
        toolEvents.push(blockedCall);
        yield blockedCall;
        const resultEvent = attachResultSummary(
          {
            type: "tool_result",
            name: toolRequest.name,
            content: gatedContent,
          },
          gatedContent,
        );
        toolEvents.push(resultEvent);
        yield resultEvent;
        conversation.llmMessages.push({
          role: "user",
          content: buildMarkPlanStepHardCapNudge(current),
        });
        continue nextToolInGroup;
      }

      const stepGate = checkPlanStepDoneGate(
        threadId,
        normalizedArgs.step_id,
        normalizedArgs.status,
        toolEvents,
        message,
      );
      if (!stepGate.allowed) {
        markPlanStepBlockCount++;
        const resultEvent = {
          type: "tool_result",
          name: toolRequest.name,
          content: appendToolStatus(toolRequest.name, stepGate.message),
        };
        toolEvents.push(resultEvent);
        yield resultEvent;
        conversation.llmMessages.push({
          role: "user",
          content: stepGate.message,
        });
        if (markPlanStepBlockCount >= 2 && !planStepLoopBriefInjected) {
          planStepLoopBriefInjected = true;
          const recovery = buildPlanStepLoopRecoveryBrief(
            threadId,
            toolEvents,
            stepGate.message,
          );
          conversation.llmMessages.push({ role: "user", content: recovery });
        }
        continue nextToolInGroup;
      }
      markPlanStepBlockCount = 0;
    }

    if (toolRequest.name === "web_search") {
      const resolved = resolveWebSearchEngines({
        requested: normalizedArgs.engines,
        threadId,
      });
      if (resolved.engines && !normalizedArgs.engines) {
        normalizedArgs = { ...normalizedArgs, engines: resolved.engines };
      }
    }

    const callEvent = withCallId(
      {
        type: "tool_call",
        name: toolRequest.name,
        args: normalizedArgs,
      },
      toolRequest,
    );
    toolEvents.push(callEvent);
    yield callEvent;
    markStackToolStart(threadId, toolRequest.name, normalizedArgs);
    yield* yieldStack(threadId);

    const planStart = await syncPlanStep(threadId, {
      toolName: toolRequest.name,
      phase: "start",
      retainPlan: retainTaskPlan,
    });
    if (planStart) yield planStart;

    yield {
      type: "status",
      phase: "tool",
      step: step + 1,
      tool: toolRequest.name,
      message: `Running ${toolRequest.name}…`,
    };

    if (!tool) {
      const suggested = suggestToolName(toolRequest.name, knownToolNames);
      const error = suggested
        ? `Unknown tool: ${toolRequest.name}. Did you mean "${suggested}"? Use: {"tool":"${suggested}","args":${describeToolSchema(suggested)}}`
        : `Unknown tool: ${toolRequest.name}. Available: ${[...knownToolNames].join(", ")}`;
      const resultEvent = {
        type: "tool_result",
        name: toolRequest.name,
        content: appendToolStatus(toolRequest.name, error),
      };
      toolEvents.push(resultEvent);
      yield resultEvent;
      conversation.llmMessages.push({
        role: "user",
        content: `Tool error: ${error}`,
      });
      continue nextToolInGroup;
    }

    blockedNoToolSteps = 0; // reset on every successful tool dispatch
    if (toolRequest.name !== "mark_plan_step") {
      markPlanStepBlockCount = 0;
    }

    const toolOutcome = await executeTool(
      tool,
      toolRequest.name,
      normalizedArgs,
      threadId,
      message,
    );
    const result = toolOutcome.display;

    if (
      (toolRequest.name === "write_file" || toolRequest.name === "search_replace") &&
      /^STATUS: SUCCESS/m.test(String(result ?? ""))
    ) {
      prematureHandoffCount = 0;
    }

    {
      const entry = { tool: toolRequest.name };
      if (normalizedArgs.path) entry.path = normalizedArgs.path;
      if (normalizedArgs.command) entry.command = normalizedArgs.command;
      if (normalizedArgs.cwd) entry.cwd = normalizedArgs.cwd;
      const exitMatch = String(result ?? "").match(/exit (\d+)/);
      if (exitMatch) entry.exitCode = Number(exitMatch[1]);
      if (toolOutcome.raw?.bytes != null) entry.bytes = toolOutcome.raw.bytes;
      else if (normalizedArgs.content) entry.bytes = normalizedArgs.content.length;
      recordAction(threadId, entry);
    }

    for (const wbEvent of await buildWorkbenchEvents(
      toolRequest.name,
      toolOutcome.normalized,
      toolOutcome.raw,
      threadId,
    )) {
      yield wbEvent;
    }

    for (const planEvent of drainPlanEvents(pendingPlanEvents)) {
      yield planEvent;
    }

    const planDone = await syncPlanStep(threadId, {
      toolName: toolRequest.name,
      phase: "done",
      succeeded: /^STATUS: SUCCESS/m.test(
        appendToolStatus(toolRequest.name, result),
      ),
      retainPlan: retainTaskPlan,
    });
    if (planDone) yield planDone;

    const storedResult = minifyToolResult(toolRequest.name, result);
    const statusResult = appendToolStatus(toolRequest.name, result);
    const skipPlanHint =
      toolRequest.name === "mark_plan_step" ||
      /^STATUS: (FAIL|BLOCKED)/m.test(statusResult) ||
      (planDone && toolRequest.name !== "mark_plan_step");
    const planHint = skipPlanHint ? "" : planStepHint(threadId);
    const displayResult = planHint
      ? `${statusResult}${planHint}`
      : statusResult;

    const resultEvent = attachResultSummary(
      withCallId(
        {
          type: "tool_result",
          name: toolRequest.name,
          content: displayResult.slice(0, 2400),
          ...(toolRequest.name === "web_search" && normalizedArgs.engines
            ? { engines: normalizedArgs.engines }
            : {}),
          ...(COMMAND_RESULT_TOOLS.has(toolRequest.name)
            ? {
                resultSummary: parseCommandToolResult(
                  toolRequest.name,
                  statusResult,
                  normalizedArgs,
                ),
              }
            : {}),
        },
        toolRequest,
      ),
      statusResult,
      normalizedArgs,
    );
    if (
      COMMAND_RESULT_TOOLS.has(toolRequest.name) &&
      resultEvent.resultSummary == null
    ) {
      const cmdSummary = parseCommandToolResult(
        toolRequest.name,
        statusResult,
        normalizedArgs,
      );
      if (cmdSummary) resultEvent.resultSummary = cmdSummary;
    }
    toolEvents.push(resultEvent);
    transcriptLog.record(threadId, "tool_result_full", {
      name: toolRequest.name,
      args: normalizedArgs,
      rawResult: result,
      displayResult,
      storedResult,
      minified: storedResult !== result,
    });
    yield resultEvent;
    await syncPlanFreezeAfterTool(threadId, toolRequest.name, displayResult);
    syncThreadVerifyFromToolResult(threadId, toolRequest.name, statusResult, {
      writtenPath: normalizedArgs?.path ?? normalizedArgs?.target_file ?? null,
    });
    if (
      isAwarenessTool(toolRequest.name) &&
      !/^STATUS: FAIL/m.test(displayResult) &&
      !/^Blocked /m.test(displayResult)
    ) {
      completeTurnAwareness(threadId);
    }

    if (toolRequest.name === "search_files") {
      const query = String(
        normalizedArgs?.query ?? toolRequest.args?.query ?? "",
      ).trim();
      if (query && countToolCallsWithArgs(toolEvents, "search_files", "query", query) >= 2) {
        ensureAwarenessComplete(threadId, toolEvents, "repeated-search");
        conversation.llmMessages.push({
          role: "user",
          content: buildRepeatedSearchFilesNudge(
            query,
            getCurrentPlanStep(threadId)?.label ?? null,
          ),
        });
      }
    }

    if (toolRequest.name === "update_task_plan") {
      if (/^STATUS: SUCCESS/m.test(statusResult)) {
        updateTaskPlanSchemaFailCount = 0;
      } else if (
        /expected schema|Tool argument error|requires ≥2 steps/i.test(displayResult)
      ) {
        updateTaskPlanSchemaFailCount++;
        if (updateTaskPlanSchemaFailCount >= 3 && !planStepLoopBriefInjected) {
          planStepLoopBriefInjected = true;
          conversation.llmMessages.push({
            role: "user",
            content: buildUpdateTaskPlanLoopNudge(),
          });
        }
      }
    }

    if (/^STATUS: SUCCESS/m.test(statusResult)) {
      if (
        (toolRequest.name === "write_file" || toolRequest.name === "search_replace") &&
        normalizedArgs?.path
      ) {
        await refreshAwarenessEntry(threadId, normalizedArgs.path);
        const parent = String(normalizedArgs.path).replace(/\/[^/]+$/, "");
        if (parent && parent !== normalizedArgs.path) {
          await refreshAwarenessEntry(threadId, parent);
        }
      }
      if (toolRequest.name === "run_bash" && normalizedArgs?.command) {
        for (const dir of extractMkdirPathsFromCommand(normalizedArgs.command)) {
          await refreshAwarenessEntry(threadId, dir);
        }
      }
    }
    await captureFailureFromToolResult({
      threadId,
      userMessage: message,
      toolName: toolRequest.name,
      toolArgs: normalizedArgs,
      toolResultContent: displayResult,
      toolEvents,
    });
    markStackToolDone(
      threadId,
      toolRequest.name,
      String(result ?? "").slice(0, 100),
    );
    yield* yieldStack(threadId);

    const workspaceEvent = await buildWorkspaceEvent(threadId);
    workspaceEvents.push(workspaceEvent);
    if (!isMinimalChatTurn(threadId)) {
      yield workspaceEvent;
    }

    refreshSystemMessage(conversation, tools);

    if (toolRequest.native && toolRequest.id) {
      conversation.llmMessages.push(
        minifyLlmMessage({
          role: "tool",
          tool_call_id: toolRequest.id,
          content: planHint ? `${storedResult}${planHint}` : storedResult,
        }),
      );
    } else {
      conversation.llmMessages.push(
        minifyLlmMessage({
          role: "user",
          content: `Tool result for ${toolRequest.name}:\n${planHint ? `${storedResult}${planHint}` : storedResult}`,
        }),
      );
    }

    if (
      toolRequest.name === "web_search" &&
      isProjectTask(message) &&
      !webSearchResultsWereUseful(toolEvents)
    ) {
      conversation.llmMessages.push({
        role: "user",
        content: buildWebSearchTrainingFallbackBrief(),
      });
    }
      }
    }
  }

  const reply = "Agent reached the maximum number of tool steps without completing verification.";
  addUiMessage(conversation, {
    role: "assistant",
    content:
      `${reply}\n\n` +
      "If stray folders (e.g. src/ at workspace root) remain outside the project, " +
      "call cleanup_stray_paths then verify_project. Otherwise summarize what was done and what still needs fixing.",
  });
  const workspaceEvent = await buildWorkspaceEvent(threadId);
  workspaceEvents.push(workspaceEvent);
  if (!isMinimalChatTurn(threadId)) {
    yield workspaceEvent;
  }

  const result = await finalizeResult({
    conversation,
    threadId,
    reply,
    toolEvents,
    workspaceEvents,
  });

  yield* yieldChatFinish(result, { threadId, toolEvents, userMessage: message });
}

export async function* agentEvents(params) {
  const threadId = params.threadId ?? "default";
  transcriptLog.beginTurn(threadId, {
    message: params.message,
    mode: params.mode ?? "chat",
  });

  try {
    for await (const event of agentEventsCore(params)) {
      transcriptLog.recordEvent(threadId, event);
      yield event;
    }
    transcriptLog.endTurn(threadId, { status: "completed" });
  } catch (error) {
    transcriptLog.record(threadId, "agent_error", {
      message: error.message,
      stack: error.stack,
    });
    transcriptLog.endTurn(threadId, { status: "error", message: error.message });
    throw error;
  }
}

export async function runAgent({ message, threadId = "default", mode = "chat" }) {
  const toolEvents = [];
  const workspaceEvents = [];
  let result = null;

  for await (const event of agentEvents({ message, threadId, mode })) {
    if (event.type === "tool_call" || event.type === "tool_result") {
      toolEvents.push(event);
    } else if (event.type === "workspace") {
      workspaceEvents.push(event);
    } else if (event.type === "context") {
      if (result) {
        result.context = {
          limit: event.limit,
          reserved: event.reserved,
          used: event.used,
          remaining: event.remaining,
          percent: event.percent,
        };
      }
    } else if (event.type === "auto_compact" && result) {
      result.autoCompacted = true;
    } else if (event.type === "message" && event.node === "agent") {
      result = {
        reply: event.content,
        context: result?.context ?? null,
        autoCompacted: result?.autoCompacted ?? false,
        cwd: event.cwd,
        workspace: event.workspace,
        messageCount: 0,
        conversationId: event.conversationId,
        direct: event.direct ?? false,
      };
    }
  }

  if (!result) {
    throw new Error("Agent finished without a response");
  }

  result.toolEvents = toolEvents;
  result.workspaceEvents = workspaceEvents;

  const conversation = await getConversation(threadId);
  result.messageCount = conversation?.llmMessages?.length ?? 0;

  return result;
}

export async function* streamAgent({ message, threadId = "default", mode = "chat" }) {
  for await (const event of agentEvents({ message, threadId, mode })) {
    yield event;
  }
}
