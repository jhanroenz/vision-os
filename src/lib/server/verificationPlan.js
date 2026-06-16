import { config } from "./config.js";
import { isCodingTask } from "./codingResearch.js";
import { requiresAgentTaskPlan } from "./knowledgeQA.js";
import { getExecutionPhase } from "./executionOrder.js";
import { hasValidPlan, isPlanComplete } from "./taskPlan.js";
import { streamChatCompletion, createChatCompletion } from "./slots.js";
import { extractCompletionText, normalizeAssistantMessage } from "./reasoning.js";
import { summarizeRecentToolEvents } from "./nextMovePlanning.js";
import {
  madeCodeChanges,
  getWrittenPaths,
  isSuccessfulToolResult,
} from "./verification.js";

const VERIFICATION_TOOLS = new Set([
  "write_file",
  "search_replace",
  "check_syntax",
  "read_file",
  "read_lints",
  "run_bash",
  "run_check",
  "verify_project",
  "check_code",
]);

const STEP_LINE =
  /^\s*(?:[-*•]|\d+[.)])\s*(?:(optional)[:\s]+)?(write_file|search_replace|check_syntax|read_file|read_lints|run_bash|run_check|verify_project|check_code)\b(?:[:\s]+([^—–\-]+))?/i;

/** @type {Map<string, { steps: object[], createdAt: number, raw: string }>} */
const checklistsByThread = new Map();

export function clearVerificationChecklist(threadId) {
  if (threadId) checklistsByThread.delete(threadId);
}

export function getVerificationChecklist(threadId) {
  return checklistsByThread.get(threadId) ?? null;
}

export function setVerificationChecklistForTest(threadId, checklist) {
  if (checklist) {
    checklistsByThread.set(threadId, checklist);
  } else {
    checklistsByThread.delete(threadId);
  }
}

function normalizePath(p) {
  return String(p ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

/**
 * @param {string} text
 * @returns {{ steps: Array<{ id: string, tool: string, target: string, description: string, required: boolean }> }}
 */
export function parseVerificationPlan(text) {
  const steps = [];
  for (const line of String(text ?? "").split("\n")) {
    const match = line.match(STEP_LINE);
    if (!match) continue;

    const optional = Boolean(match[1]);
    const tool = match[2].toLowerCase();
    let rest = String(match[3] ?? "").trim();
    let description = "";

    const dash = rest.search(/\s[—–\-]\s/);
    if (dash >= 0) {
      description = rest.slice(dash + 1).replace(/^[—–\-]\s*/, "").trim();
      rest = rest.slice(0, dash).trim();
    }

    const target =
      tool === "verify_project"
        ? rest || "project"
        : rest.replace(/^on\s+/i, "").trim();

    steps.push({
      id: String(steps.length + 1),
      tool,
      target,
      description: description || line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim(),
      required: !optional,
    });
  }

  return { steps };
}

function storeChecklist(threadId, raw, parsed) {
  checklistsByThread.set(threadId, {
    steps: parsed.steps,
    createdAt: Date.now(),
    raw: String(raw ?? "").trim(),
  });
}

function findToolCallBeforeResult(toolEvents, resultIndex, toolName) {
  for (let i = resultIndex - 1; i >= 0; i--) {
    const event = toolEvents[i];
    if (event.type === "tool_call" && event.name === toolName) return event;
    if (event.type === "tool_result") break;
  }
  return null;
}

function pathMatches(stepTarget, actualPath) {
  const target = normalizePath(stepTarget);
  const actual = normalizePath(actualPath);
  if (!target || !actual) return !target;
  return (
    actual === target ||
    actual.endsWith(`/${target}`) ||
    target.endsWith(`/${actual}`)
  );
}

function commandMatches(stepTarget, command) {
  const target = String(stepTarget ?? "").trim().toLowerCase();
  const cmd = String(command ?? "").trim().toLowerCase();
  if (!target) return true;
  if (!cmd) return false;
  return cmd.includes(target) || target.includes(cmd);
}

/**
 * @returns {"pass" | "fail" | "pending"}
 */
export function evaluateChecklistStep(step, toolEvents) {
  const tool = step.tool;
  let sawFail = false;

  for (let i = 0; i < toolEvents.length; i++) {
    const event = toolEvents[i];
    if (event.type !== "tool_result" || event.name !== tool) continue;

    const call = findToolCallBeforeResult(toolEvents, i, tool);
    const content = String(event.content ?? "");

    if (tool === "check_syntax") {
      const path = call?.args?.path ?? "";
      if (step.target && !pathMatches(step.target, path)) continue;
      if (/RESULT:\s*SUCCESS/i.test(content) && isSuccessfulToolResult(event)) {
        return "pass";
      }
      if (/RESULT:\s*FAILED/i.test(content)) sawFail = true;
      continue;
    }

    if (tool === "read_file") {
      const path = call?.args?.path ?? "";
      if (step.target && !pathMatches(step.target, path)) continue;
      if (isSuccessfulToolResult(event) && !/File not found:/i.test(content)) {
        return "pass";
      }
      if (/File not found:/i.test(content)) sawFail = true;
      continue;
    }

    if (tool === "run_bash" || tool === "run_check") {
      const command = call?.args?.command ?? "";
      if (step.target && !commandMatches(step.target, command)) continue;
      if (/RESULT:\s*SUCCESS/i.test(content) && isSuccessfulToolResult(event)) {
        return "pass";
      }
      if (/RESULT:\s*FAILED/i.test(content)) sawFail = true;
      continue;
    }

    if (tool === "verify_project") {
      if (/OVERALL:\s*PASS/i.test(content)) return "pass";
      if (/OVERALL:\s*FAIL/i.test(content)) sawFail = true;
      continue;
    }

    if (tool === "read_lints" || tool === "check_code") {
      if (/RESULT:\s*SUCCESS/i.test(content) || /STATUS:\s*SUCCESS/i.test(content)) {
        return "pass";
      }
      if (/RESULT:\s*FAILED|STATUS:\s*FAIL/i.test(content)) sawFail = true;
      continue;
    }

    if (tool === "write_file" || tool === "search_replace") {
      const path = call?.args?.path ?? "";
      if (step.target && !pathMatches(step.target, path)) continue;
      if (isSuccessfulToolResult(event)) return "pass";
      sawFail = true;
    }
  }

  return sawFail ? "fail" : "pending";
}

/**
 * @returns {{
 *   steps: Array<{ id: string, tool: string, target: string, description: string, required: boolean, status: string }>,
 *   allRequiredPassed: boolean,
 *   hasFailure: boolean,
 *   pendingRequired: string[],
 * } | null}
 */
export function evaluateVerificationEvidence(threadId, toolEvents) {
  const checklist = getVerificationChecklist(threadId);
  if (!checklist?.steps?.length) return null;

  const steps = checklist.steps.map((step) => ({
    ...step,
    status: evaluateChecklistStep(step, toolEvents),
  }));

  const required = steps.filter((s) => s.required);
  const pendingRequired = required
    .filter((s) => s.status === "pending")
    .map((s) => `${s.tool}${s.target ? ` ${s.target}` : ""}`);
  const hasFailure = steps.some((s) => s.required && s.status === "fail");
  const allRequiredPassed = required.length > 0 && required.every((s) => s.status === "pass");

  return {
    steps,
    allRequiredPassed,
    hasFailure,
    pendingRequired,
  };
}

export function hasChecklistEvidence(threadId, toolEvents) {
  const ev = evaluateVerificationEvidence(threadId, toolEvents);
  return Boolean(ev?.allRequiredPassed);
}

export function buildChecklistStatusBlock(threadId, toolEvents) {
  const ev = evaluateVerificationEvidence(threadId, toolEvents);
  if (!ev) return "";

  const lines = ["Verification checklist:"];
  for (const step of ev.steps) {
    const icon =
      step.status === "pass" ? "✓" : step.status === "fail" ? "✗" : "○";
    const req = step.required ? "" : " (optional)";
    const target = step.target ? ` ${step.target}` : "";
    lines.push(`  ${icon} ${step.tool}${target}${req}`);
  }

  if (ev.pendingRequired.length) {
    lines.push("");
    lines.push(`Pending required: ${ev.pendingRequired.join(", ")}`);
  }

  if (ev.hasFailure) {
    lines.push("");
    lines.push(
      "Failed step(s) need a code fix (search_replace/write_file) before re-running the same check.",
    );
  }

  return lines.join("\n");
}

const PLANNER_SYSTEM = `You are Jarvis's internal verification planner (not visible to Master Jan).

Given the user's goal, files written this turn, project context, and recent tool results, produce a concrete self-verification checklist before handoff.

Rules:
- 3-8 bullet lines only
- Each line starts with "- " and names exactly one tool: write_file, search_replace, check_syntax, read_file, read_lints, run_check, run_bash, or verify_project
- Include the file path or command after the tool name (e.g. "- check_syntax src/App.vue — Vue SFC structure")
- Mark optional steps with "optional" before the tool name
- Always include check_syntax for every code file written this turn (after any fix steps for that file)
- Include read_file only when you still need to inspect content — NOT as a substitute for fixing a known error
- Include run_check or run_bash for build/lint/test when package.json scripts exist or errors suggest them
- verify_project is optional when you already listed individual run_bash checks
- Do NOT call tools. Plain bullet list only — no JSON, no headings

CRITICAL — when recent tool results already show FAIL (check_syntax, run_bash build, verify_project):
- Re-running the same check without editing the file cannot fix the issue
- First bullet(s) MUST be search_replace or write_file naming the broken file and the specific fix (e.g. add missing </style>, import/mount the component in App.vue)
- Put fix steps BEFORE re-check steps for the same file/command
- Never plan only: check_syntax → read_file → check_syntax with no edit in between`;

/** Extract actionable failures from recent tool results for the planner. */
export function summarizeKnownFailures(toolEvents, limit = 6) {
  const lines = [];
  const events = (toolEvents ?? []).slice(-limit * 2);

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.type !== "tool_result") continue;
    const content = String(event.content ?? "");
    const failed =
      /RESULT:\s*FAILED|STATUS:\s*FAIL|OVERALL:\s*FAIL/i.test(content);
    if (!failed) continue;

    const call = findToolCallBeforeResult(events, i, event.name);
    const path = call?.args?.path ?? "";
    const command = call?.args?.command ?? "";

    const diagnostic = content
      .split("\n")
      .map((line) => line.trim())
      .find(
        (line) =>
          /^line \d+/i.test(line) ||
          /Missing|SyntaxError|error TS|Error:/i.test(line),
      );

    if (event.name === "check_syntax" && path) {
      lines.push(
        `- check_syntax FAILED on ${path}${diagnostic ? `: ${diagnostic.trim()}` : ""}`,
      );
    } else if (
      (event.name === "run_bash" || event.name === "run_check") &&
      command
    ) {
      lines.push(`- ${event.name} FAILED: ${command}`);
    } else if (event.name === "verify_project") {
      lines.push("- verify_project FAILED (build/lint/test)");
    }
  }

  return lines.length ? lines.join("\n") : "";
}

/**
 * Static verification checklist from changed files (no LLM).
 */
export function buildDeterministicVerificationChecklist(ctx) {
  const { toolEvents, threadId } = ctx ?? {};
  const written = getWrittenPaths(toolEvents);
  if (!written.length) return "";

  const lines = [
    "- check_syntax on changed files",
    ...written.slice(0, 6).map((p) => `- read_file: ${p}`),
    "- verify_project: project",
  ];

  const raw = lines.join("\n");
  const parsed = parseVerificationPlan(raw);
  if (threadId && parsed.steps.length) {
    storeChecklist(threadId, raw, parsed);
  }
  return raw;
}

/**
 * @param {{ toolEvents?: Array, message?: string, threadId?: string }} ctx
 */
export function shouldRunVerificationPlanning(ctx) {
  const { toolEvents, message, threadId } = ctx ?? {};
  if (!config.agent.verificationPlanningEnabled) return false;
  if (!config.agent.verificationPlanningLlm) return false;
  if (!requiresAgentTaskPlan(message) && !isCodingTask(message)) return false;
  if (!madeCodeChanges(toolEvents)) return false;
  if (getVerificationChecklist(threadId)) return false;
  if (getExecutionPhase(message, toolEvents, threadId) !== "execute") return false;
  if (hasValidPlan(threadId) && !isPlanComplete(threadId)) return false;
  return true;
}

/**
 * @param {{
 *   userMessage: string,
 *   toolEvents: Array,
 *   threadId: string,
 *   step: number,
 * }} ctx
 */
export function buildVerificationPlanningMessages(ctx) {
  const { userMessage, toolEvents, threadId, step } = ctx;
  const written = getWrittenPaths(toolEvents);
  const knownFailures = summarizeKnownFailures(toolEvents);

  const userBlock = [
    `Master Jan's request: ${userMessage}`,
    `Agent loop step: ${step + 1}`,
    written.length
      ? `Files written this turn:\n${written.map((p) => `  - ${p}`).join("\n")}`
      : "(no write_file paths recorded)",
    "",
    "Recent tool activity:",
    summarizeRecentToolEvents(toolEvents),
    ...(knownFailures
      ? [
          "",
          "Known failures (plan search_replace/write_file fixes BEFORE re-running these checks):",
          knownFailures,
        ]
      : []),
    "",
    "Write the verification checklist. Use only these tools:",
    [...VERIFICATION_TOOLS].join(", "),
  ].join("\n");

  return [
    { role: "system", content: PLANNER_SYSTEM },
    { role: "user", content: userBlock },
  ];
}

export function formatVerificationPlanInjection(planText, threadId) {
  const trimmed = String(planText ?? "").trim();
  if (!trimmed) return "";

  const parsed = parseVerificationPlan(trimmed);
  if (parsed.steps.length) {
    storeChecklist(threadId, trimmed, parsed);
  }

  const checklistLines = parsed.steps.length
    ? [
        "",
        "Parsed checklist (run each required step before handoff):",
        ...parsed.steps.map((s) => {
          const req = s.required ? "required" : "optional";
          const target = s.target ? ` ${s.target}` : "";
          return `  ${s.id}. ${s.tool}${target} (${req})`;
        }),
      ].join("\n")
    : "";

  return (
    `[Verification plan — execute before handoff]\n${trimmed}${checklistLines}\n\n` +
    "Execute each required step in order. " +
    "When a step fails or recent activity already shows FAIL with a clear diagnostic (missing tag, wrong import, syntax line), " +
    "call search_replace or write_file to apply the fix immediately — do NOT only read_file or re-run the same check hoping for a different result. " +
    "After each fix, re-run the failed check, then continue the checklist. " +
    "Hand off only after all required steps pass."
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
 * @param {object} ctx
 * @param {number} ctx.step — 0-based loop index
 */
export async function* runVerificationPlanningPhase(ctx) {
  if (!config.agent.verificationPlanningEnabled) {
    yield {
      type: "status",
      phase: "planning_verify",
      message: "Planning verification steps…",
    };
    return;
  }

  const planningMessages = buildVerificationPlanningMessages(ctx);

  yield {
    type: "status",
    phase: "planning_verify",
    message: "Planning verification steps…",
  };

  let planText = "";

  for await (const event of streamChatCompletion(planningMessages, {
    maxTokens: config.agent.verificationPlanningMaxTokens,
    temperature: 0.15,
    cachePrompt: false,
  })) {
    if (event.type === "delta" && event.field === "content") {
      planText += event.text;
      yield {
        type: "verification_plan_delta",
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
      maxTokens: config.agent.verificationPlanningMaxTokens,
      temperature: 0.15,
      cachePrompt: false,
    });
    planText = extractCompletionText(response).trim();
  }

  if (planText) {
    const parsed = parseVerificationPlan(planText);
    if (parsed.steps.length) {
      storeChecklist(ctx.threadId, planText, parsed);
    }
    yield {
      type: "verification_plan",
      step: ctx.step + 1,
      content: planText,
      checklist: parsed.steps,
    };
  }
}
