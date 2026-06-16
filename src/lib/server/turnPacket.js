import { config } from "./config.js";
import { TURN_PACKET_PREFIX } from "./briefLifecycle.js";
import { getTurnIntent } from "./turnIntent.js";
import { getExecutionPhase } from "./executionOrder.js";
import {
  getLockedProjectRoot,
  getThreadCwd,
  getActiveProjectRoot,
} from "./workspace.js";
import {
  hasValidPlan,
  getCurrentPlanStep,
  planProgressSummary,
  isPlanComplete,
} from "./taskPlan.js";
import { getTurnAwareness } from "./workspacePreflight.js";
import {
  acceptanceCriteriaBlock,
} from "./acceptanceCriteria.js";
import { buildIntentAssessmentBrief } from "./intentAssessment.js";
import { getKnownPaths, getFileContextState } from "./fileContext.js";
import { formatWorkspaceFileMapLines } from "./workspaceFileMap.js";
import { getWrittenPaths, getLastVerifyResult } from "./verification.js";
import { isPlanFrozen } from "./planFreeze.js";
import {
  buildDeterministicVerificationChecklist,
  getVerificationChecklist,
} from "./verificationPlan.js";
import { buildAgentStepContextBrief } from "./agentStepContext.js";

/** @type {Map<string, object>} */
const turnContextByThread = new Map();

export function initTurnContext(threadId, data = {}) {
  if (!threadId) return;
  turnContextByThread.set(threadId, { ...data });
}

export function getTurnContext(threadId) {
  return turnContextByThread.get(threadId) ?? {};
}

export function patchTurnContext(threadId, patch) {
  if (!threadId) return;
  turnContextByThread.set(threadId, {
    ...getTurnContext(threadId),
    ...patch,
  });
}

export function clearTurnContext(threadId) {
  turnContextByThread.delete(threadId);
}

function compactAwarenessLines(preflight) {
  if (!preflight?.entries?.length) {
    return "not scanned — call inspect_codebase or list_directory";
  }
  const rows = preflight.entries.slice(0, 16).map((e) => {
    const tag = e.exists ? "EXISTS" : "MISSING";
    return `${tag} ${e.path}`;
  });
  if (preflight.entries.length > 16) {
    rows.push(`…${preflight.entries.length - 16} more`);
  }
  return rows.join("; ");
}

function phaseRules(phase, { frozen, complete }) {
  const rules = [];
  if (phase === "research") {
    rules.push("web_search once before other tools");
  }
  if (phase === "awareness") {
    rules.push("read-only tools only; mark EXISTS/MISSING before plan");
    rules.push("batch independent reads in one tool_calls reply");
  }
  if (phase === "plan") {
    rules.push("update_task_plan before write_file");
    rules.push("mirror SKIP/CREATE from awareness");
  }
  if (phase === "execute") {
    rules.push("follow locked plan step; mark_plan_step when done");
    if (frozen) rules.push("plan frozen — no rewrite");
    if (!complete) rules.push("verify_project on final step");
  }
  return rules.slice(0, 5);
}

function buildPacketFileSection(threadId, maxChars = 1500) {
  const state = getFileContextState(threadId);
  const lines = [];
  const known = getKnownPaths(threadId);
  if (known.length) {
    lines.push(`known: ${known.slice(-10).join(", ")}`);
  }
  if (state.recentFiles.length) {
    const recent = state.recentFiles
      .slice(0, 8)
      .map((e) => e.path)
      .join(", ");
    lines.push(`recent: ${recent}`);
  }
  if (state.workspaceFileMap?.paths?.length) {
    lines.push(
      formatWorkspaceFileMapLines(state.workspaceFileMap, { maxChars: maxChars - 80 }),
    );
  }
  const text = lines.join("\n").trim();
  if (!text) return "(none — use search_files / inspect_codebase)";
  return text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text;
}

/**
 * @param {string} threadId
 * @param {{
 *   step?: number,
 *   maxSteps?: number,
 *   userMessage?: string,
 *   toolEvents?: Array,
 *   phase?: string,
 *   includeVerification?: boolean,
 *   fileMaxChars?: number,
 * }} [opts]
 */
export async function buildTurnPacket(threadId, opts = {}) {
  const {
    step = 0,
    maxSteps = 24,
    userMessage = "",
    toolEvents = [],
    fileMaxChars = 1500,
  } = opts;

  const turnIntent = getTurnIntent(threadId) ?? {};
  const phase =
    opts.phase ??
    getExecutionPhase(userMessage, toolEvents, threadId) ??
    "execute";
  const ctx = getTurnContext(threadId);
  const awareness = getTurnAwareness(threadId);
  const preflight = ctx.preflight ?? awareness?.preflight ?? null;
  const locked = getLockedProjectRoot(threadId);
  const cwd = getThreadCwd(threadId);
  const active = getActiveProjectRoot(threadId);
  const progress = hasValidPlan(threadId)
    ? (planProgressSummary(threadId) ?? "?")
    : "(no plan)";
  const current = getCurrentPlanStep(threadId);
  const planLine = current
    ? `${current.id}: ${current.label} (${current.status})`
    : progress;

  const lines = [
    TURN_PACKET_PREFIX,
    `phase: ${phase} | step: ${step + 1}/${maxSteps}`,
    locked
      ? `project: ${locked} (locked)`
      : active
        ? `project: ${active}`
        : `cwd: ${cwd}`,
    `awareness: ${compactAwarenessLines(preflight)}`,
    `plan: ${planLine}`,
  ];

  const intentBrief = buildIntentAssessmentBrief(turnIntent);
  if (intentBrief) lines.push(`intent: ${intentBrief.replace(/^\[Intent:[^\]]+\]\s*/, "")}`);

  const criteria = acceptanceCriteriaBlock(threadId);
  if (criteria) lines.push(criteria);

  if (ctx.turnStartNote) lines.push(`note: ${ctx.turnStartNote}`);

  lines.push(`files:\n${buildPacketFileSection(threadId, fileMaxChars)}`);

  const stepBrief = await buildAgentStepContextBrief(threadId, {
    toolEvents,
    step,
  });
  if (stepBrief) {
    const compact = stepBrief
      .split("\n")
      .filter((l) => !l.startsWith("[Agent step context"))
      .join("\n");
    lines.push(`step:\n${compact}`);
  }

  const written = getWrittenPaths(toolEvents);
  if (written.length) {
    lines.push(`written: ${written.join(", ")}`);
  }

  const verify = getLastVerifyResult(toolEvents);
  if (verify) {
    const pass = /OVERALL:\s*PASS/i.test(verify.content ?? "");
    lines.push(`verify: ${pass ? "PASS" : "FAIL/partial"}`);
  }

  if (
    opts.includeVerification !== false &&
    step > 0 &&
    written.length &&
    !getVerificationChecklist(threadId)
  ) {
    const checklist = buildDeterministicVerificationChecklist({
      userMessage,
      toolEvents,
      threadId,
      step,
    });
    if (checklist) lines.push(`verification:\n${checklist}`);
  } else {
    const existing = getVerificationChecklist(threadId);
    if (existing?.raw) {
      lines.push(`verification:\n${existing.raw.slice(0, 600)}`);
    }
  }

  const rules = phaseRules(phase, {
    frozen: isPlanFrozen(threadId),
    complete: isPlanComplete(threadId),
  });
  if (rules.length) {
    lines.push("rules:", ...rules.map((r) => `- ${r}`));
  }

  if (config.agent?.loopV2) {
    lines.push(
      "- Independent read-only tools → multiple tool_calls in one reply",
    );
  }

  return lines.join("\n");
}

export function shrinkTurnPacketContent(content, { dropFiles = true } = {}) {
  const lines = String(content ?? "").split("\n");
  const out = [];
  let skipUntilNextSection = false;

  for (const line of lines) {
    if (line.startsWith("files:") && dropFiles) {
      out.push("files: (trimmed — use inspect_codebase)");
      skipUntilNextSection = true;
      continue;
    }
    if (
      skipUntilNextSection &&
      /^(phase:|plan:|rules:|verification:|step:|awareness:)/.test(line)
    ) {
      skipUntilNextSection = false;
    }
    if (skipUntilNextSection) continue;
    if (line.startsWith("verification:") && dropFiles) {
      out.push("verification: (trimmed)");
      skipUntilNextSection = true;
      continue;
    }
    out.push(line);
  }

  return out.join("\n");
}
