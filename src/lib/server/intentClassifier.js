import { config } from "./config.js";
import { isCodingTask, userOptedOutOfWebResearch, EXPLICIT_TOOL_WORK, isSimpleFilesystemTask } from "./codingResearch.js";
import { isUiTask } from "./uiDesignGuidance.js";
import {
  isKnowledgeQuestion,
  hasCodebaseLookupIntent,
  requiresAgentTaskPlan,
} from "./knowledgeQA.js";
import { isPersonaOrMemoryInstruction, isMemorySaveRequest } from "./messageIntent.js";
import {
  hasSearchIntent,
  isCasualChatMessage,
  needsExternalFacts,
} from "./webSearchEligibility.js";
import { isWorkspaceMetaQuestion } from "./workspaceMeta.js";

/** NLI labels — descriptive phrases work best for zero-shot models. */
const ZEROSHOT_LABELS = [
  ["casual", "casual greeting, thanks, or vague ping with no real task"],
  ["web", "needs live web search for external facts or current events"],
  ["explore", "exploring or searching the local codebase without editing"],
  ["code", "implementing, fixing, or scaffolding code in the project"],
  ["shell", "running tests, build, lint, or other shell commands"],
];

const CLASSIFIER_PROMPT = `Classify the user message for Jarvis (local coding assistant). Return ONLY JSON:
{"profile":"chat|research|explore|code","casual_chat":bool,"web_search":bool,"require_web_research_first":bool,"reason":"short"}

Rules:
- casual_chat: greetings, thanks, vague pings with no task
- web_search: external/current facts (not local codebase)
- require_web_research_first: true ONLY when the user explicitly asks to search the web before coding (not for generic scaffold/fix tasks)
- profile "code" when the task changes code/UI even if web search is also needed
- profile "chat" or "research" for conceptual Q&A (algorithms, comparisons, explainers) — no task plan

Examples:
hey → {"profile":"chat","casual_chat":true,"web_search":false,"require_web_research_first":false,"reason":"Greeting"}
grep auth → {"profile":"explore","casual_chat":false,"web_search":false,"require_web_research_first":false,"reason":"Code search"}
any other sorting algorithm? → {"profile":"chat","casual_chat":false,"web_search":false,"require_web_research_first":false,"reason":"Follow-up Q&A"}
search the best way to do bubble sort in javascript → {"profile":"research","casual_chat":false,"web_search":true,"require_web_research_first":false,"reason":"Educational lookup"}
search the web and refine the UI → {"profile":"code","casual_chat":false,"web_search":true,"require_web_research_first":true,"reason":"UI work plus research"}
create vue app → {"profile":"code","casual_chat":false,"web_search":false,"require_web_research_first":false,"reason":"Scaffold"}`;

let zeroShotPipeline = null;
let zeroShotLoading = null;

function parseIntentJson(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeProfile(value) {
  const profile = String(value ?? "chat").toLowerCase();
  return ["chat", "research", "explore", "code", "tools"].includes(profile)
    ? profile
    : "chat";
}

/**
 * @returns {import("./turnIntent.js").TurnIntent}
 */
export function buildTurnIntentFromSignals({
  profile,
  casualChat,
  allowWebSearch,
  requireWebResearchFirst,
  source,
  reason,
  saveToMemory = false,
  actionSummary,
  askMode = false,
  workspaceMetaQuestion = false,
  followUpProjectWork = false,
}) {
  const casual = Boolean(casualChat);
  const resolvedProfile = casual ? "chat" : profile;
  const webAllowed =
    allowWebSearch !== undefined
      ? Boolean(allowWebSearch)
      : !casual && resolvedProfile !== "chat";
  const followUp = Boolean(followUpProjectWork) && !casual;

  return {
    profile: resolvedProfile,
    casualChat: casual,
    askMode: Boolean(askMode),
    allowWebSearch: casual ? false : webAllowed,
    requireWebResearchFirst: Boolean(requireWebResearchFirst) && !casual && !followUp,
    followUpProjectWork: followUp,
    saveToMemory: Boolean(saveToMemory) && !casual,
    workspaceMetaQuestion: Boolean(workspaceMetaQuestion) && !casual && resolvedProfile === "chat",
    actionSummary: actionSummary ? String(actionSummary).slice(0, 400) : undefined,
    source,
    reason,
  };
}

function applyUserPreferences(message, intent) {
  if (!userOptedOutOfWebResearch(message)) return intent;
  return {
    ...intent,
    allowWebSearch: false,
    requireWebResearchFirst: false,
  };
}

function validateLlmRaw(raw, message) {
  const casualChat = Boolean(raw.casual_chat);
  const profile = normalizeProfile(raw.profile);
  let requireWebResearchFirst = Boolean(raw.require_web_research_first);

  if (casualChat) {
    requireWebResearchFirst = false;
  }

  if (
    requireWebResearchFirst &&
    !config.agent.requireWebResearchForCoding
  ) {
    requireWebResearchFirst = false;
  }

  return applyUserPreferences(
    message,
    buildTurnIntentFromSignals({
      profile,
      casualChat,
      allowWebSearch: Boolean(raw.web_search) && !casualChat,
      requireWebResearchFirst,
      saveToMemory: Boolean(raw.save_to_memory),
      actionSummary: typeof raw.action === "string" ? raw.action : undefined,
      source: "llm",
      reason: typeof raw.reason === "string" ? raw.reason.slice(0, 200) : undefined,
    }),
  );
}

async function getZeroShotClassifier() {
  if (zeroShotPipeline) return zeroShotPipeline;
  if (!zeroShotLoading) {
    zeroShotLoading = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      zeroShotPipeline = await pipeline(
        "zero-shot-classification",
        config.intentClassifier.zeroshotModel,
      );
      return zeroShotPipeline;
    })();
  }
  return zeroShotLoading;
}

function scoreMap(output) {
  const map = {};
  for (let i = 0; i < output.labels.length; i++) {
    const key = ZEROSHOT_LABELS.find(([, text]) => text === output.labels[i])?.[0];
    if (key) map[key] = output.scores[i];
  }
  return map;
}

function mapZeroShotToIntent(message, output) {
  const scores = scoreMap(output);
  const threshold = config.intentClassifier.zeroshotThreshold;
  const casualChat = (scores.casual ?? 0) >= threshold;

  if (casualChat) {
    return applyUserPreferences(
      message,
      buildTurnIntentFromSignals({
        profile: "chat",
        casualChat: true,
        allowWebSearch: false,
        requireWebResearchFirst: false,
        source: "zero-shot",
        reason: `casual ${(scores.casual * 100).toFixed(0)}%`,
      }),
    );
  }

  const ranked = ["code", "shell", "explore", "web"]
    .map((key) => [key, scores[key] ?? 0])
    .sort((a, b) => b[1] - a[1]);

  const [topKey, topScore] = ranked[0];
  let profile = "chat";
  if (topScore >= threshold) {
    if (topKey === "web") profile = "research";
    else if (topKey === "explore") profile = "explore";
    else profile = "code";
  }

  const requireWebResearchFirst =
    profile === "code" &&
    config.agent.requireWebResearchForCoding &&
    (scores.code ?? 0) >= threshold;

  return guardMisclassifiedCodeIntent(
    applyUserPreferences(
      message,
      buildTurnIntentFromSignals({
        profile,
        casualChat: false,
        requireWebResearchFirst,
        source: "zero-shot",
        reason: `${topKey} ${(topScore * 100).toFixed(0)}%`,
      }),
    ),
    message,
  );
}

async function classifyWithLlm(message) {
  const { createChatCompletion } = await import("./slots.js");
  const response = await createChatCompletion(
    [
      { role: "system", content: CLASSIFIER_PROMPT },
      { role: "user", content: String(message ?? "").trim() },
    ],
    {
      maxTokens: config.intentClassifier.llmMaxTokens,
      temperature: 0,
      cachePrompt: false,
    },
  );

  const content = response.choices?.[0]?.message?.content ?? "";
  const parsed = parseIntentJson(content);
  if (!parsed) return null;
  return validateLlmRaw(parsed, message);
}

async function classifyWithZeroShot(message) {
  const classifier = await getZeroShotClassifier();
  const labels = ZEROSHOT_LABELS.map(([, text]) => text);
  const output = await classifier(String(message ?? "").trim(), labels, {
    multi_label: true,
  });
  return mapZeroShotToIntent(message, output);
}

function defaultIntent(message) {
  return applyUserPreferences(
    message,
    buildTurnIntentFromSignals({
      profile: "chat",
      casualChat: true,
      allowWebSearch: false,
      requireWebResearchFirst: false,
      source: "default",
      reason: "classifier unavailable",
    }),
  );
}

/** Obvious intents — skip LLM/zero-shot for faster conversational turns. */
function classifyWithHeuristics(message) {
  const text = String(message ?? "").trim();
  if (!text) return null;

  if (isCasualChatMessage(text)) {
    return applyUserPreferences(
      text,
      buildTurnIntentFromSignals({
        profile: "chat",
        casualChat: true,
        allowWebSearch: false,
        requireWebResearchFirst: false,
        source: "heuristic",
        reason: "casual chat",
      }),
    );
  }

  if (isPersonaOrMemoryInstruction(text)) {
    return applyUserPreferences(
      text,
      buildTurnIntentFromSignals({
        profile: "chat",
        casualChat: false,
        allowWebSearch: false,
        requireWebResearchFirst: false,
        saveToMemory:
          isMemorySaveRequest(text) || /\bcore memory\b/i.test(text),
        source: "heuristic",
        reason: "persona or core memory instruction",
        actionSummary:
          "Acknowledge the identity context and call remember to save it.",
      }),
    );
  }

  if (isKnowledgeQuestion(text)) {
    const wantsSearch =
      hasSearchIntent(text) ||
      /\bsearch\b/i.test(text) ||
      needsExternalFacts(text);
    return applyUserPreferences(
      text,
      buildTurnIntentFromSignals({
        profile: wantsSearch ? "research" : "chat",
        casualChat: false,
        allowWebSearch: wantsSearch,
        requireWebResearchFirst: false,
        source: "heuristic",
        reason: wantsSearch ? "knowledge Q&A + search" : "knowledge Q&A",
      }),
    );
  }

  if (hasCodebaseLookupIntent(text)) {
    return applyUserPreferences(
      text,
      buildTurnIntentFromSignals({
        profile: "explore",
        casualChat: false,
        allowWebSearch: false,
        requireWebResearchFirst: false,
        source: "heuristic",
        reason: "codebase explore",
      }),
    );
  }

  if (isWorkspaceMetaQuestion(text)) {
    return applyUserPreferences(
      text,
      buildTurnIntentFromSignals({
        profile: "chat",
        casualChat: false,
        allowWebSearch: false,
        requireWebResearchFirst: false,
        workspaceMetaQuestion: true,
        source: "heuristic",
        reason: "workspace location question",
        actionSummary: "Answer with current workspace paths only.",
      }),
    );
  }

  if (isSimpleFilesystemTask(text)) {
    return applyUserPreferences(
      text,
      buildTurnIntentFromSignals({
        profile: "tools",
        casualChat: false,
        allowWebSearch: false,
        requireWebResearchFirst: false,
        source: "heuristic",
        reason: "simple filesystem",
        actionSummary: "Run mkdir or list_directory — no research or task plan.",
      }),
    );
  }

  if (isCodingTask(text) || isUiTask(text)) {
    const requireWeb =
      hasSearchIntent(text) ||
      /\bsearch the web\b/i.test(text) ||
      (config.agent.requireWebResearchForCoding &&
        (/\b(create|scaffold|setup|build|implement|new)\b/i.test(text) ||
          isUiTask(text)));
    return applyUserPreferences(
      text,
      buildTurnIntentFromSignals({
        profile: "code",
        casualChat: false,
        requireWebResearchFirst: requireWeb,
        source: "heuristic",
        reason: EXPLICIT_TOOL_WORK.test(text) ? "explicit tool work" : isUiTask(text) ? "ui task" : "coding task",
      }),
    );
  }

  if (hasSearchIntent(text)) {
    return applyUserPreferences(
      text,
      buildTurnIntentFromSignals({
        profile: "research",
        casualChat: false,
        allowWebSearch: true,
        requireWebResearchFirst: false,
        source: "heuristic",
        reason: "web search intent",
      }),
    );
  }

  if (needsExternalFacts(text)) {
    return applyUserPreferences(
      text,
      buildTurnIntentFromSignals({
        profile: "research",
        casualChat: false,
        allowWebSearch: true,
        requireWebResearchFirst: false,
        source: "heuristic",
        reason: "external facts lookup",
      }),
    );
  }

  if (/\b(grep|search codebase|find (?:the )?(?:file|function|handler|class)|inspect|semantic_search|glob_files)\b/i.test(text)) {
    return applyUserPreferences(
      text,
      buildTurnIntentFromSignals({
        profile: "explore",
        casualChat: false,
        requireWebResearchFirst: false,
        source: "heuristic",
        reason: "codebase explore",
      }),
    );
  }

  return null;
}

/** Zero-shot / LLM sometimes labels release-note questions as code — override. */
export function guardMisclassifiedCodeIntent(intent, message) {
  if (!intent || intent.profile !== "code") return intent;
  if (isSimpleFilesystemTask(message)) {
    return applyUserPreferences(
      message,
      buildTurnIntentFromSignals({
        profile: "tools",
        casualChat: false,
        allowWebSearch: false,
        requireWebResearchFirst: false,
        source: intent.source ?? "default",
        reason: "simple filesystem (code guard)",
        actionSummary: "Run mkdir or list_directory — no research or task plan.",
      }),
    );
  }
  if (hasCodebaseLookupIntent(message)) {
    return applyUserPreferences(
      message,
      buildTurnIntentFromSignals({
        profile: "explore",
        casualChat: false,
        allowWebSearch: false,
        requireWebResearchFirst: false,
        source: intent.source ?? "default",
        reason: "codebase explore (code guard)",
      }),
    );
  }
  if (requiresAgentTaskPlan(message) || isCodingTask(message)) return intent;

  if (hasSearchIntent(message)) {
    return applyUserPreferences(
      message,
      buildTurnIntentFromSignals({
        profile: "research",
        casualChat: false,
        allowWebSearch: true,
        requireWebResearchFirst: false,
        source: intent.source ?? "default",
        reason: "research lookup (not workspace coding)",
      }),
    );
  }

  return applyUserPreferences(
    message,
    buildTurnIntentFromSignals({
      profile: "chat",
      casualChat: false,
      allowWebSearch: false,
      requireWebResearchFirst: false,
      source: intent.source ?? "default",
      reason: "chat (not workspace coding)",
    }),
  );
}

/** Skip the assessment LLM when heuristics are unambiguous. */
export function tryConfidentHeuristicIntent(message) {
  const text = String(message ?? "").trim();
  if (!text) return null;

  const heuristic = classifyWithHeuristics(text);
  if (!heuristic || heuristic.source !== "heuristic") return null;

  if (heuristic.casualChat) return heuristic;

  const reason = heuristic.reason ?? "";
  if (reason === "persona or core memory instruction") return heuristic;
  if (reason.startsWith("knowledge Q&A")) return heuristic;
  if (reason === "web search intent") return heuristic;
  if (reason === "external facts lookup") return heuristic;
  if (reason === "codebase explore") return heuristic;
  if (reason === "workspace location question") return heuristic;
  if (reason === "simple filesystem") return heuristic;
  if (heuristic.profile === "code" && reason === "coding task") return heuristic;
  if (heuristic.profile === "code" && reason === "ui task") return heuristic;
  if (heuristic.profile === "code" && reason === "explicit tool work") return heuristic;

  return null;
}

/** Classify user intent — heuristics first, then LLM and/or zero-shot model. */
export async function classifyUserIntent(message) {
  const mode = config.intentClassifier.mode;
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

  const heuristic = classifyWithHeuristics(text);
  if (heuristic) return heuristic;

  if (mode === "zero-shot") {
    try {
      return await classifyWithZeroShot(text);
    } catch {
      return defaultIntent(text);
    }
  }

  if (mode === "llm") {
    try {
      const intent = await classifyWithLlm(text);
      return intent ?? defaultIntent(text);
    } catch {
      return defaultIntent(text);
    }
  }

  try {
    const llm = await classifyWithLlm(text);
    if (llm) return llm;
  } catch {
    // fall through
  }

  try {
    return await classifyWithZeroShot(text);
  } catch {
    return defaultIntent(text);
  }
}

/** Fallback when intent assessment LLM fails — heuristics then zero-shot, no second LLM pass. */
export async function classifyUserIntentFallback(message) {
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

  const heuristic = classifyWithHeuristics(text);
  if (heuristic) return heuristic;

  if (config.intentClassifier.mode !== "llm") {
    try {
      const intent = guardMisclassifiedCodeIntent(
        await classifyWithZeroShot(text),
        text,
      );
      return intent;
    } catch {
      return defaultIntent(text);
    }
  }

  return defaultIntent(text);
}
