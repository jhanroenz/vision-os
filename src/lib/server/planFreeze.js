import {
  getTaskPlan,
  getCurrentPlanStep,
  planProgressSummary,
  setPlanExecutionMode,
} from "./taskPlan.js";
import { getExecutionPhase } from "./executionOrder.js";

export const PLAN_MODE_FROZEN = "frozen";
export const PLAN_MODE_EXECUTING = "executing";

/** Workspace-relative plan todo files (.jarvis/plans/*.json). */
export function isPlanTodoFilePath(relativePath) {
  const p = String(relativePath ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  return /^\.jarvis\/plans\/[^/]+\.json$/i.test(p);
}

export function isPlanFrozen(threadId) {
  const plan = getTaskPlan(threadId);
  return plan?.mode === PLAN_MODE_FROZEN;
}

export async function freezePlanExecution(threadId) {
  return setPlanExecutionMode(threadId, PLAN_MODE_FROZEN);
}

export async function unlockPlanExecution(threadId) {
  return setPlanExecutionMode(threadId, PLAN_MODE_EXECUTING);
}

/**
 * Block full plan rewrites during frozen execute — mark_plan_step and plan file writes stay allowed.
 */
export function isBlockedPlanRewrite(toolName, { message, toolEvents, threadId } = {}) {
  if (toolName !== "update_task_plan") return false;
  if (!isPlanFrozen(threadId)) return false;
  if (getExecutionPhase(message, toolEvents, threadId) !== "execute") return false;
  return true;
}

export function buildPlanRewriteBlockedMessage(threadId) {
  const current = getCurrentPlanStep(threadId);
  return (
    `Blocked update_task_plan: execution plan is FROZEN — do not replan or rewrite steps.\n` +
    (current
      ? `Execute the locked step now: ${current.id}. ${current.label}\n`
      : "") +
    `Use mark_plan_step to update step status, or write_file on the plan file (${getTaskPlan(threadId)?.planFile ?? ".jarvis/plans/…"}) to sync todos.\n` +
    `Plan unlocks automatically after a tool returns STATUS: FAIL or verify_project OVERALL: FAIL.`
  );
}

/** Executor-only brief — replaces next-move replanning while frozen. */
export function buildExecutionCommitBrief(threadId) {
  const plan = getTaskPlan(threadId);
  if (!plan?.steps?.length) return "";

  const current = getCurrentPlanStep(threadId);
  const progress = planProgressSummary(threadId);

  const lines = [
    "[EXECUTION LOCK — planner off, executor only]",
    `Task plan ${progress} complete. Replanning is blocked until a tool fails.`,
  ];

  if (current) {
    lines.push(
      `NOW EXECUTING (locked): Step ${current.id} — ${current.label}`,
      "Do NOT call update_task_plan, re-derive the plan, or reconsider step order.",
      "Call exactly ONE execute tool for this step (" +
        "run_bash, write_file, read_file, verify_project, mark_plan_step, …).",
      "When the step is truly finished, call mark_plan_step.",
    );
  } else if (plan.steps.every((s) => s.status === "done" || s.status === "skipped")) {
    lines.push(
      "All plan steps are done. Run verify_project if needed, then hand off with an outcome summary (what changed and why) — not a tool or STATUS recap.",
    );
  }

  return lines.join("\n");
}

export function toolResultFailed(content) {
  const text = String(content ?? "");
  if (/^STATUS: INFO/m.test(text)) return false;
  return (
    /^STATUS: FAIL/m.test(text) ||
    /^STATUS: BLOCKED/m.test(text) ||
    /OVERALL:\s*FAIL/i.test(text)
  );
}

export async function syncPlanFreezeAfterTool(threadId, toolName, resultContent) {
  if (toolName === "update_task_plan") {
    await freezePlanExecution(threadId);
    return;
  }

  const plan = getTaskPlan(threadId);
  if (!plan?.steps?.length) return;

  if (toolResultFailed(resultContent)) {
    if (isPlanFrozen(threadId)) {
      await unlockPlanExecution(threadId);
    }
    return;
  }

  await freezePlanExecution(threadId);
}
