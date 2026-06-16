import { config } from "./config.js";
import { getExecutionPhase } from "./executionOrder.js";
import { requiresAgentTaskPlan } from "./knowledgeQA.js";
import { planStatusBlock, getCurrentPlanStep, hasValidPlan, isPlanComplete } from "./taskPlan.js";
import { isPlanFrozen } from "./planFreeze.js";
import { streamChatCompletion, createChatCompletion } from "./slots.js";
import { extractCompletionText, normalizeAssistantMessage } from "./reasoning.js";

function plannerSystemPrompt() {
  return `You are Jarvis's internal next-move planner (not visible to Master Jan).

Given the user's goal, execution phase, task plan state, and recent tool results, decide what the agent should do next.

Rules:
- 2–5 bullet points only
- First bullet: what was just accomplished or learned from the last tool result
- Middle bullets: gap analysis vs the goal / current plan step
- Final bullet: ONE specific next action (exact tool: run_bash, write_file, read_file, verify_project, or "reply in plain text" if done)
- Reference concrete paths, queries, or plan step ids when known
- Do NOT call tools. Do NOT greet or address the user. Planner notes only.
- Plain text bullets (lines starting with "-") — no JSON, no markdown headings`;
}

/**
 * @param {Array<{ type?: string, name?: string, args?: object, content?: string }>} toolEvents
 */
export function summarizeRecentToolEvents(toolEvents, limit = 10) {
  const lines = [];
  for (const event of (toolEvents ?? []).slice(-limit)) {
    if (event.type === "tool_call") {
      const args = event.args ? JSON.stringify(event.args) : "";
      const short = args.length > 160 ? `${args.slice(0, 157)}…` : args;
      lines.push(`→ ${event.name}(${short})`);
    } else if (event.type === "tool_result") {
      const body = String(event.content ?? "")
        .replace(/^STATUS: \w+\n?/m, "")
        .trim();
      const short = body.length > 420 ? `${body.slice(0, 417)}…` : body;
      lines.push(`← ${event.name}: ${short}`);
    }
  }
  return lines.length ? lines.join("\n") : "(no tool activity yet)";
}

function hasSuccessfulToolResult(toolEvents) {
  return (toolEvents ?? []).some(
    (e) =>
      e.type === "tool_result" &&
      e.name &&
      !/^Blocked/i.test(String(e.content ?? "")) &&
      !/^Web search failed/i.test(String(e.content ?? "")),
  );
}

/**
 * Extra planning LLM pass — coding execute phase only (after task plan exists).
 * @param {{ toolEvents?: Array, message?: string, threadId?: string }} ctx
 */
export function shouldRunNextMovePlanning(ctx) {
  const { toolEvents, message, threadId } = ctx ?? {};
  if (!config.agent.nextMovePlanningEnabled) return false;
  if (!config.agent.nextMovePlanningLlm) return false;
  if (!requiresAgentTaskPlan(message)) return false;
  if (!hasValidPlan(threadId)) return false;
  if (isPlanComplete(threadId)) return false;
  if (getExecutionPhase(message, toolEvents, threadId) !== "execute") return false;
  if (isPlanFrozen(threadId)) return false;
  return hasSuccessfulToolResult(toolEvents);
}

/**
 * @param {{
 *   userMessage: string,
 *   toolEvents: Array,
 *   threadId: string,
 *   step: number,
 * }} ctx
 */
export function buildNextMovePlanningMessages(ctx) {
  const { userMessage, toolEvents, threadId, step } = ctx;
  const phase = getExecutionPhase(userMessage, toolEvents, threadId);
  const planBlock = planStatusBlock(threadId);
  const currentStep = getCurrentPlanStep(threadId);
  const currentStepLine = currentStep
    ? `Active plan step: ${currentStep.id}. ${currentStep.label} (${currentStep.status})`
    : "";

  const userBlock = [
    `Master Jan's request: ${userMessage}`,
    `Agent loop step: ${step + 1}`,
    `Execution phase: ${phase}`,
    planBlock || "(no task plan)",
    currentStepLine,
    "",
    "Recent tool activity:",
    summarizeRecentToolEvents(toolEvents),
    "",
    "Write the next-move plan (2–5 bullets) for this step.",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: plannerSystemPrompt() },
    { role: "user", content: userBlock },
  ];
}

export function formatNextMovePlanInjection(planText, step) {
  const trimmed = String(planText ?? "").trim();
  if (!trimmed) return "";
  return (
    `[Next-move plan — agent step ${step}]\n${trimmed}\n\n` +
    "Follow this plan now. Execute the final bullet's primary action with a tool JSON call, " +
    "or reply in plain text only if the plan says the task is complete."
  );
}

function completionTextFromDoneEvent(event) {
  if (!event?.message) return "";
  const normalized = normalizeAssistantMessage(event.message);
  const content = String(normalized.content ?? "").trim();
  if (content) return content;
  return String(normalized.reasoning_content ?? "").trim();
}

/**
 * Dedicated planning LLM pass after a tool step. Yields planning_delta / planning events.
 * @param {object} ctx
 * @param {number} ctx.step — 0-based loop index
 */
export async function* runNextMovePlanningPhase(ctx) {
  if (!config.agent.nextMovePlanningEnabled) {
    yield { type: "status", phase: "planning_next", message: "Planning next moves…" };
    return;
  }

  const planningMessages = buildNextMovePlanningMessages(ctx);

  yield { type: "status", phase: "planning_next", message: "Planning next moves…" };

  let planText = "";

  for await (const event of streamChatCompletion(planningMessages, {
    maxTokens: config.agent.nextMovePlanningMaxTokens,
    temperature: 0.15,
    cachePrompt: false,
  })) {
    if (event.type === "delta" && event.field === "content") {
      planText += event.text;
      yield {
        type: "planning_delta",
        content: event.text,
        step: ctx.step + 1,
      };
    } else if (event.type === "done") {
      const fromDone = completionTextFromDoneEvent(event);
      if (fromDone && fromDone.length > planText.length) {
        planText = fromDone;
      }
    }
  }

  planText = planText.trim();
  if (!planText) {
    const response = await createChatCompletion(planningMessages, {
      maxTokens: config.agent.nextMovePlanningMaxTokens,
      temperature: 0.15,
      cachePrompt: false,
    });
    planText = extractCompletionText(response).trim();
  }

  if (planText) {
    yield {
      type: "planning",
      step: ctx.step + 1,
      content: planText,
    };
  }
}
