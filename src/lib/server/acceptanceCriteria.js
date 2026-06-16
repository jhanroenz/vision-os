import { config } from "./config.js";
import { requiresAgentTaskPlan } from "./knowledgeQA.js";
import { isCodingTask } from "./codingResearch.js";
import { getTurnAwareness, isAwarenessComplete } from "./workspacePreflight.js";
import { streamChatCompletion, createChatCompletion } from "./slots.js";
import { extractCompletionText, normalizeAssistantMessage } from "./reasoning.js";

/** @type {Map<string, { bullets: string[], raw: string, synthesized: boolean }>} */
const turnCriteria = new Map();

const CRITERIA_SYSTEM = `You are Jarvis's internal acceptance-criteria planner (not visible to Master Jan).

Given Master Jan's coding request and workspace awareness, produce a definition of done for this turn.

Rules:
- 3–6 bullet lines only
- Each line starts with "- "
- Observable outcomes Jan can verify (UI behavior, file content, build passes) — NOT tool names
- No read_file, write_file, verify_project, inspect_ast, or STATUS in bullets
- Plain bullet list only — no JSON, no headings, no preamble`;

export function clearAcceptanceCriteria(threadId) {
  if (!threadId) return;
  turnCriteria.delete(threadId);
}

export function getAcceptanceCriteria(threadId) {
  return turnCriteria.get(threadId) ?? null;
}

export function hasAcceptanceCriteria(threadId) {
  const entry = turnCriteria.get(threadId);
  return Boolean(entry?.synthesized && entry.bullets?.length);
}

function parseCriteriaBullets(text) {
  const bullets = [];
  for (const line of String(text ?? "").split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(/^[-*•]\s+(.+)/);
    if (match?.[1]) bullets.push(match[1].trim());
  }
  return bullets.slice(0, 8);
}

export function storeAcceptanceCriteria(threadId, rawText) {
  const bullets = parseCriteriaBullets(rawText);
  if (!threadId || !bullets.length) return null;
  const entry = {
    bullets,
    raw: String(rawText ?? "").trim(),
    synthesized: true,
  };
  turnCriteria.set(threadId, entry);
  return entry;
}

export function acceptanceCriteriaBlock(threadId) {
  const entry = turnCriteria.get(threadId);
  if (!entry?.bullets?.length) return "";

  return [
    "Acceptance criteria (definition of done this turn):",
    ...entry.bullets.map((b) => `  • ${b}`),
  ].join("\n");
}

export function formatAcceptanceCriteriaInjection(text, threadId) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return "";

  const entry = storeAcceptanceCriteria(threadId, trimmed);
  if (!entry) return "";

  return (
    `[Acceptance criteria — definition of done for this turn]\n${trimmed}\n\n` +
    "Use update_task_plan to create steps that satisfy each criterion. " +
    "Omit steps for paths already marked EXISTS/SKIP in workspace awareness. " +
    "Final plan step must be verify."
  );
}

/**
 * @param {{ message?: string, threadId?: string, awarenessBrief?: string }} ctx
 */
export function shouldSynthesizeAcceptanceCriteria(ctx) {
  const { message, threadId, awarenessBrief } = ctx ?? {};
  if (!config.agent.acceptanceCriteriaEnabled) return false;
  if (!config.agent.acceptanceCriteriaLlm) return false;
  if (!threadId) return false;
  if (hasAcceptanceCriteria(threadId)) return false;

  const msg = String(message ?? "");
  if (!requiresAgentTaskPlan(msg) && !isCodingTask(msg)) return false;

  if (requiresAgentTaskPlan(msg) && !isAwarenessComplete(threadId)) {
    if (!awarenessBrief?.trim()) return false;
  }

  return true;
}

/**
 * Deterministic acceptance criteria (no LLM) for agent loop v2.
 */
export function buildDeterministicAcceptanceCriteria(userMessage, preflight) {
  const msg = String(userMessage ?? "").trim();
  const bullets = [];

  if (msg) {
    const summary = msg.length > 100 ? `${msg.slice(0, 97)}...` : msg;
    bullets.push(`User request addressed: ${summary}`);
  }

  const missing = (preflight?.entries ?? []).filter((e) => !e.exists).slice(0, 3);
  const exists = (preflight?.entries ?? []).filter((e) => e.exists).slice(0, 2);
  if (missing.length) {
    bullets.push(`Create or update: ${missing.map((e) => e.path).join(", ")}`);
  }
  if (exists.length) {
    bullets.push(`Preserve existing: ${exists.map((e) => e.path).join(", ")}`);
  }

  bullets.push("Project builds or runs without errors");
  bullets.push("verify_project passes before handoff");

  const raw = bullets.map((b) => `- ${b}`).join("\n");
  return raw;
}

export function applyDeterministicAcceptanceCriteria(threadId, userMessage, preflight) {
  const raw = buildDeterministicAcceptanceCriteria(userMessage, preflight);
  return storeAcceptanceCriteria(threadId, raw);
}

/**
 * @param {{
 *   userMessage: string,
 *   threadId: string,
 *   awarenessBrief?: string,
 * }} ctx
 */
export function buildAcceptanceCriteriaMessages(ctx) {
  const { userMessage, threadId, awarenessBrief } = ctx;
  const awareness = getTurnAwareness(threadId);
  const inventory =
    awarenessBrief?.trim() ||
    (awareness?.preflight?.entries?.length
      ? awareness.preflight.entries
          .slice(0, 12)
          .map((e) => `  ${e.exists ? "EXISTS" : "MISSING"}: ${e.path}`)
          .join("\n")
      : "(no paths pre-scanned)");

  const userBlock = [
    `Master Jan's request: ${userMessage}`,
    "",
    "Workspace awareness:",
    inventory,
    "",
    "Write 3–6 acceptance criteria bullets (definition of done).",
  ].join("\n");

  return [
    { role: "system", content: CRITERIA_SYSTEM },
    { role: "user", content: userBlock },
  ];
}

function completionTextFromDoneEvent(event) {
  if (!event?.message) return "";
  const normalized = normalizeAssistantMessage(event.message);
  const content = String(normalized.content ?? "").trim();
  if (content) return content;
  return String(normalized.reasoning_content ?? "").trim();
}

/**
 * @param {{ userMessage: string, threadId: string, awarenessBrief?: string }} ctx
 */
export async function* runAcceptanceCriteriaSynthesis(ctx) {
  if (!config.agent.acceptanceCriteriaEnabled) {
    return;
  }

  const planningMessages = buildAcceptanceCriteriaMessages(ctx);

  yield {
    type: "status",
    phase: "acceptance_criteria",
    message: "Synthesizing acceptance criteria…",
  };

  let criteriaText = "";

  for await (const event of streamChatCompletion(planningMessages, {
    maxTokens: config.agent.acceptanceCriteriaMaxTokens,
    temperature: 0.15,
    cachePrompt: false,
  })) {
    if (event.type === "delta" && event.field === "content") {
      criteriaText += event.text;
      yield {
        type: "acceptance_criteria_delta",
        content: event.text,
      };
    } else if (event.type === "done") {
      const fromDone = completionTextFromDoneEvent(event);
      if (fromDone && fromDone.length > criteriaText.length) {
        criteriaText = fromDone;
      }
    }
  }

  criteriaText = criteriaText.trim();
  if (!criteriaText) {
    const response = await createChatCompletion(planningMessages, {
      maxTokens: config.agent.acceptanceCriteriaMaxTokens,
      temperature: 0.15,
      cachePrompt: false,
    });
    criteriaText = extractCompletionText(response).trim();
  }

  if (criteriaText) {
    storeAcceptanceCriteria(ctx.threadId, criteriaText);
    yield {
      type: "acceptance_criteria",
      content: criteriaText,
    };
  }
}

/** Test helper — set criteria without LLM. */
export function setAcceptanceCriteriaForTest(threadId, bullets) {
  turnCriteria.set(threadId, {
    bullets: Array.isArray(bullets) ? bullets : [String(bullets)],
    raw: bullets.join("\n"),
    synthesized: true,
  });
}
