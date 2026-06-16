import { config } from "./config.js";
import { userOptedOutOfWebResearch, isInPlaceProjectWork } from "./codingResearch.js";
import {
  buildTurnIntentFromSignals,
  guardMisclassifiedCodeIntent,
} from "./intentClassifier.js";
import { isMemorySaveRequest, isPersonaOrMemoryInstruction } from "./messageIntent.js";
import { createChatCompletion } from "./slots.js";
import {
  getLockedProjectRoot,
  getActiveProjectRoot,
} from "./workspace.js";
import { getFileContextState } from "./fileContext.js";
import { loadExecutionPlan } from "./executionPlan.js";

const ASSESSMENT_SYSTEM = `Intent router. JSON only:
{"profile":"chat|research|explore|code","casual_chat":bool,"web_search":bool,"require_web_research_first":bool,"follow_up_project_work":bool,"save_to_memory":bool,"workspace_meta":bool,"reason":"short","action":"one line"}

chat=conversation/persona/memory/Q&A (no workspace edits). research=web facts. explore=read/search codebase. code=implement/fix/scaffold files.
follow_up_project_work=true when the user continues, fixes, or debugs work on the locked project from prior turns (wrong UI, boilerplate still showing, broken after prior build). Requires locked project + prior work in context. When true: require_web_research_first MUST be false.
require_web_research_first=true ONLY when the user explicitly asks to search the web before coding — not for generic scaffold/fix tasks (unless AGENT_REQUIRE_WEB_RESEARCH=true).
workspace_meta=true ONLY when the user asks where the workspace/cwd/project folder is.
Persona/backstory/core memory→chat,save_to_memory:true,NOT code. casual_chat only for pure greetings.`;

const FOLLOW_UP_ASSESSMENT_SYSTEM = `Follow-up detector for an existing coding project. JSON only:
{"follow_up_project_work":bool,"reason":"short"}

true = user continues/fixes/debugs the SAME locked project from prior turns (wrong UI, boilerplate, wiring bug, "please fix", report after running, missing feature from prior plan).
false = brand-new scaffold, unrelated question, different folder, or no connection to prior project work.

Use the locked project root, prior plan, and recent turns — not keyword matching alone.`;

function parseAssessmentJson(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeProfile(value) {
  const profile = String(value ?? "chat").toLowerCase();
  return ["chat", "research", "explore", "code", "tools"].includes(profile)
    ? profile
    : "chat";
}

function resolveLockedProjectRoot(conversation, threadId) {
  let locked = getLockedProjectRoot(threadId);
  if (locked && locked !== ".") return locked;

  const convRoot = conversation?.projectRoot;
  if (convRoot && convRoot !== ".") return convRoot;

  const convCwd = conversation?.cwd;
  if (convCwd && convCwd !== ".") return convCwd;

  const active = getActiveProjectRoot(threadId);
  if (active && active !== ".") return active;

  const hints = getFileContextState(threadId).mentionedProjects ?? [];
  const lastHint = hints[hints.length - 1];
  if (lastHint && lastHint !== ".") return lastHint;

  return null;
}

function summarizePriorPlan(priorPlan) {
  if (!priorPlan?.steps?.length) return null;
  const done = priorPlan.steps.filter(
    (s) => s.status === "done" || s.status === "skipped",
  ).length;
  const lines = priorPlan.steps.map((s) => `${s.id}. [${s.status}] ${s.label}`);
  return {
    title: priorPlan.title ?? "Task plan",
    progress: `${done}/${priorPlan.steps.length}`,
    complete: done === priorPlan.steps.length,
    stepsSummary: lines.join("\n"),
  };
}

/** Prior assistant turn included workspace implementation (not just Q&A). */
export function hasRecentCodingWork(recentMessages = []) {
  const codingMarkers =
    /\b(write_file|search_replace|verify_project|run_bash|task plan|scaffold|npm (?:create|run)|check_syntax|Calculator|boilerplate)\b/i;
  return recentMessages.some(
    (m) => m.role === "assistant" && codingMarkers.test(String(m.content ?? "")),
  );
}

/**
 * @param {import("./conversations.js").Conversation} conversation
 * @param {string} threadId
 */
export async function buildIntentAssessmentContext(conversation, threadId) {
  const lockedProjectRoot = resolveLockedProjectRoot(conversation, threadId);
  const priorPlanRaw = await loadExecutionPlan(threadId);
  const priorPlan = summarizePriorPlan(priorPlanRaw);

  const recentMessages = (conversation?.uiMessages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-6)
    .map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
    }));

  return {
    lockedProjectRoot,
    recentMessages,
    priorPlan,
    priorPlanComplete: priorPlan?.complete === true,
  };
}

/** @param {import("./conversations.js").Conversation} conversation */
export function buildIntentAssessmentContextFromState(conversation, lockedProjectRoot) {
  const recentMessages = (conversation?.uiMessages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-6)
    .map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
    }));

  return {
    lockedProjectRoot: lockedProjectRoot ?? null,
    recentMessages,
    priorPlan: null,
    priorPlanComplete: false,
  };
}

/**
 * @param {object} [context]
 * @param {string|null} [context.lockedProjectRoot]
 * @param {{ role: string, content: string }[]} [context.recentMessages]
 * @param {object|null} [context.priorPlan]
 */
export function buildIntentAssessmentUserContent(message, context = {}) {
  const parts = [String(message ?? "").trim()];
  const locked = context.lockedProjectRoot;
  const recent = context.recentMessages ?? [];
  const priorPlan = context.priorPlan;

  parts.push("", "Conversation context:");
  if (locked && locked !== ".") {
    parts.push(`Locked project root: ${locked}`);
  } else {
    parts.push("Locked project root: (none — follow_up_project_work must be false)");
  }

  if (priorPlan) {
    parts.push(
      `Prior task plan: "${priorPlan.title}" (${priorPlan.progress} complete)`,
      priorPlan.stepsSummary,
    );
  }

  if (recent.length > 0) {
    parts.push("Recent turns:");
    for (const turn of recent) {
      const snippet = String(turn.content ?? "").replace(/\s+/g, " ").slice(0, 500);
      parts.push(`${turn.role}: ${snippet}`);
    }
  }

  return parts.join("\n");
}

function buildFollowUpAssessmentUserContent(message, context = {}) {
  const parts = [
    `User message: ${String(message ?? "").trim()}`,
    `Locked project root: ${context.lockedProjectRoot ?? "(none)"}`,
  ];
  if (context.priorPlan) {
    parts.push(
      `Prior completed plan: "${context.priorPlan.title}" (${context.priorPlan.progress})`,
      context.priorPlan.stepsSummary,
    );
  }
  if (context.recentMessages?.length) {
    parts.push("Recent turns:");
    for (const turn of context.recentMessages) {
      const snippet = String(turn.content ?? "").replace(/\s+/g, " ").slice(0, 400);
      parts.push(`${turn.role}: ${snippet}`);
    }
  }
  return parts.join("\n");
}

/**
 * Dedicated LLM pass when prior project work exists — decides follow-up vs fresh work.
 * @returns {Promise<{ followUp: boolean, reason?: string } | null>}
 */
export async function runFollowUpAssessment(message, context = {}) {
  if (!context.lockedProjectRoot || context.lockedProjectRoot === ".") {
    return { followUp: false, reason: "no locked project" };
  }

  const hasPriorWork =
    context.priorPlanComplete === true || hasRecentCodingWork(context.recentMessages);
  if (!hasPriorWork) {
    return { followUp: false, reason: "no prior coding work" };
  }

  try {
    const response = await createChatCompletion(
      [
        { role: "system", content: FOLLOW_UP_ASSESSMENT_SYSTEM },
        { role: "user", content: buildFollowUpAssessmentUserContent(message, context) },
      ],
      {
        maxTokens: config.agent.intentAssessmentMaxTokens,
        temperature: 0,
        cachePrompt: false,
      },
    );

    const parsed = parseAssessmentJson(response.choices?.[0]?.message?.content ?? "");
    if (!parsed) return null;
    return {
      followUp: Boolean(parsed.follow_up_project_work),
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 120) : undefined,
    };
  } catch (error) {
    console.warn("[followUpAssessment]", error?.message ?? error);
    return null;
  }
}

/**
 * @param {import("./turnIntent.js").TurnIntent} intent
 * @param {string} message
 * @param {object} context
 */
export function applyFollowUpToIntent(intent, message, context, { reason, source = "llm-follow-up" } = {}) {
  return guardMisclassifiedCodeIntent(
    buildTurnIntentFromSignals({
      profile: intent.profile === "chat" ? "code" : intent.profile,
      casualChat: false,
      allowWebSearch: intent.allowWebSearch,
      requireWebResearchFirst: false,
      followUpProjectWork: true,
      saveToMemory: intent.saveToMemory,
      workspaceMetaQuestion: intent.workspaceMetaQuestion,
      actionSummary: intent.actionSummary,
      source,
      reason: reason ?? intent.reason,
    }),
    message,
  );
}

/**
 * @param {object} raw
 * @param {string} message
 * @param {object} [context]
 * @returns {import("./turnIntent.js").TurnIntent | null}
 */
export function validateAssessmentRaw(raw, message, context = {}) {
  if (!raw || typeof raw !== "object") return null;

  let casualChat = Boolean(raw.casual_chat);
  let profile = normalizeProfile(raw.profile);
  let saveToMemory = Boolean(raw.save_to_memory);
  let webSearch = Boolean(raw.web_search);
  let requireWebResearchFirst = Boolean(raw.require_web_research_first);

  if (isPersonaOrMemoryInstruction(message)) {
    profile = "chat";
    casualChat = false;
    saveToMemory =
      saveToMemory ||
      isMemorySaveRequest(message) ||
      /\bcore memory\b/i.test(message);
    webSearch = false;
    requireWebResearchFirst = false;
  }

  if (
    /\b(run_bash|write_file|read_file|search_replace|mkdir|use tools only|use tools)\b/i.test(
      String(message ?? ""),
    )
  ) {
    profile = "code";
    casualChat = false;
    webSearch = false;
    requireWebResearchFirst = false;
  }

  if (/\buse tools only\b/i.test(String(message ?? ""))) {
    requireWebResearchFirst = false;
    webSearch = false;
  }

  if (casualChat) {
    profile = "chat";
    saveToMemory = false;
    webSearch = false;
    requireWebResearchFirst = false;
  }

  if (profile === "chat" && !webSearch) {
    requireWebResearchFirst = false;
  }

  if (requireWebResearchFirst && !config.agent.requireWebResearchForCoding) {
    requireWebResearchFirst = false;
  }

  if (userOptedOutOfWebResearch(message)) {
    webSearch = false;
    requireWebResearchFirst = false;
  }

  if (isInPlaceProjectWork(message)) {
    requireWebResearchFirst = false;
  }

  let followUpProjectWork = Boolean(raw.follow_up_project_work);
  const lockedRoot = context.lockedProjectRoot;
  if (!lockedRoot || lockedRoot === ".") {
    followUpProjectWork = false;
  }
  if (followUpProjectWork) {
    requireWebResearchFirst = false;
    profile = profile === "chat" ? "code" : profile;
    casualChat = false;
  }

  let workspaceMetaQuestion = Boolean(raw.workspace_meta);
  if (profile === "code" || profile === "explore" || casualChat) {
    workspaceMetaQuestion = false;
  }

  return guardMisclassifiedCodeIntent(
    buildTurnIntentFromSignals({
      profile,
      casualChat,
      allowWebSearch: webSearch,
      requireWebResearchFirst,
      saveToMemory,
      workspaceMetaQuestion,
      followUpProjectWork,
      actionSummary:
        typeof raw.action === "string" ? raw.action.slice(0, 200) : undefined,
      source: "llm-assessment",
      reason:
        typeof raw.reason === "string" ? raw.reason.slice(0, 120) : undefined,
    }),
    message,
  );
}

/**
 * @param {string} message
 * @param {object} [context]
 */
export async function runIntentAssessment(message, context = {}) {
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

  const response = await createChatCompletion(
    [
      { role: "system", content: ASSESSMENT_SYSTEM },
      { role: "user", content: buildIntentAssessmentUserContent(text, context) },
    ],
    {
      maxTokens: config.agent.intentAssessmentMaxTokens,
      temperature: 0,
      cachePrompt: false,
    },
  );

  const content = response.choices?.[0]?.message?.content ?? "";
  const parsed = parseAssessmentJson(content);
  if (!parsed) return null;
  return validateAssessmentRaw(parsed, text, context);
}

/**
 * One-line nudge for non-chat profiles only (chat rules are in lite system prompt).
 * @param {import("./turnIntent.js").TurnIntent} intent
 */
export function buildIntentAssessmentBrief(intent) {
  if (!intent || intent.source === "heuristic" || intent.profile === "chat") {
    return "";
  }

  const parts = [`[Intent:${intent.profile}]`];
  if (intent.followUpProjectWork) parts.push("Follow-up on locked project.");
  if (intent.actionSummary) parts.push(intent.actionSummary);
  if (intent.profile === "research") parts.push("Cite URLs.");
  if (intent.profile === "explore") parts.push("Read/search only unless asked to edit.");
  return parts.join(" ");
}
