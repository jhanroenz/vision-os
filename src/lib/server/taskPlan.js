import { acceptanceCriteriaBlock } from "./acceptanceCriteria.js";

const turnPlans = new Map();

const VALID_STATUS = new Set(["pending", "in_progress", "done", "skipped"]);

/** Only these successful tools auto-complete the active plan step. */
const ADVANCE_ON_SUCCESS_TOOLS = new Set([
  "write_file",
  "search_replace",
  "apply_template",
  "verify_project",
  "semantic_search",
  "grep_code",
  "glob_files",
]);

async function persistPlan(threadId, plan) {
  const { persistExecutionPlan } = await import("./executionPlan.js");
  plan.planFile = await persistExecutionPlan(threadId, plan, {
    mode: plan.mode ?? "executing",
  });
  return plan;
}

export function getTaskPlan(threadId) {
  return turnPlans.get(threadId) ?? null;
}

/** Test helper � set an in-memory plan without persisting to disk. */
export function setTaskPlanForTest(threadId, plan) {
  turnPlans.set(threadId, plan);
}

export function clearTaskPlan(threadId) {
  turnPlans.delete(threadId);
}

export function getCurrentPlanStep(threadId) {
  const plan = turnPlans.get(threadId);
  if (!plan?.steps?.length) return null;
  return (
    plan.steps.find((s) => s.status === "in_progress") ??
    plan.steps.find((s) => s.status === "pending") ??
    null
  );
}

/** Ensure exactly one in_progress step; promote first pending if none active. */
export function ensureSingleActiveStep(plan) {
  if (!plan?.steps?.length) return plan;

  const inProgress = plan.steps.filter((s) => s.status === "in_progress");
  if (inProgress.length > 1) {
    for (let i = 1; i < inProgress.length; i++) {
      inProgress[i].status = "pending";
    }
  }

  if (!plan.steps.some((s) => s.status === "in_progress")) {
    const next = plan.steps.find((s) => s.status === "pending");
    if (next) next.status = "in_progress";
  }

  return plan;
}

function completeActiveStepAndAdvance(plan) {
  const active = plan.steps.find((s) => s.status === "in_progress");
  if (!active) {
    ensureSingleActiveStep(plan);
    return true;
  }

  if (active.status !== "done") {
    active.status = "done";
  }

  const next = plan.steps.find((s) => s.status === "pending");
  if (next) {
    next.status = "in_progress";
  }

  return true;
}

function mergeStepFromUpdate(prev, step, index) {
  const id = String(step.id ?? index + 1);
  let status = VALID_STATUS.has(step.status) ? step.status : "pending";
  if (prev) {
    if (!step.status && (prev.status === "done" || prev.status === "skipped")) {
      status = prev.status;
    } else if (!step.status && prev.status === "in_progress") {
      status = prev.status;
    }
  }
  return {
    id,
    label: step.label ?? prev?.label ?? `Step ${index + 1}`,
    status,
    tool: step.tool ?? prev?.tool ?? null,
    args: step.args ?? prev?.args ?? null,
  };
}

export async function applyPlanFromTool(threadId, { title, steps }) {
  const existing = turnPlans.get(threadId);
  const created = !existing;

  const previousById = new Map(
    (existing?.steps ?? []).map((s) => [String(s.id), s]),
  );

  const normalizedSteps = (steps ?? []).map((step, index) =>
    mergeStepFromUpdate(previousById.get(String(step.id ?? index + 1)), step, index),
  );

  const plan = {
    id: existing?.id ?? crypto.randomUUID(),
    title: title ?? existing?.title ?? "Task plan",
    steps: normalizedSteps,
    created,
    planFile: existing?.planFile ?? null,
    mode: "executing",
  };

  ensureSingleActiveStep(plan);
  await persistPlan(threadId, plan);
  turnPlans.set(threadId, plan);

  const { freezePlanExecution } = await import("./planFreeze.js");
  await freezePlanExecution(threadId);

  return plan;
}

export async function markPlanStep(threadId, stepId, status) {
  const plan = turnPlans.get(threadId);
  if (!plan?.steps?.length) return null;

  const normalizedStatus = VALID_STATUS.has(status) ? status : "pending";
  const step = plan.steps.find((s) => s.id === String(stepId));
  if (!step) return null;

  if (normalizedStatus === "in_progress") {
    for (const s of plan.steps) {
      if (s.status === "in_progress") s.status = "pending";
    }
    step.status = "in_progress";
  } else {
    step.status = normalizedStatus;
    if (normalizedStatus === "done") {
      const next = plan.steps.find((s) => s.status === "pending");
      if (next) next.status = "in_progress";
    }
  }

  ensureSingleActiveStep(plan);
  await persistPlan(threadId, plan);
  turnPlans.set(threadId, plan);
  return plan;
}

export async function setPlanExecutionMode(threadId, mode = "executing") {
  const plan = turnPlans.get(threadId);
  if (!plan) return null;
  plan.mode = mode;
  const { setExecutionPlanMode } = await import("./executionPlan.js");
  await setExecutionPlanMode(threadId, mode);
  if (mode === "executing") ensureSingleActiveStep(plan);
  turnPlans.set(threadId, plan);
  return plan;
}

/** Replace a stale completed plan with a short fix checklist on follow-up turns. */
export async function seedFollowUpFixPlan(threadId, message, lockedRoot) {
  const target =
    lockedRoot && lockedRoot !== "." ? lockedRoot : "project";
  const plan = {
    id: `fix-${Date.now()}`,
    title: `Fix: ${String(message ?? "").slice(0, 80).trim()}`,
    steps: [
      {
        id: "1",
        label: `Diagnose and fix in ${target}: read entry (App.vue/main.*), wire components, resolve reported UI issue`,
        status: "in_progress",
      },
      {
        id: "2",
        label: "Verify: check_syntax on changed files and verify_project",
        status: "pending",
      },
    ],
    mode: "executing",
    created: true,
  };
  ensureSingleActiveStep(plan);
  await persistPlan(threadId, plan);
  turnPlans.set(threadId, plan);
  return plan;
}

export async function hydrateTaskPlanFromDisk(threadId) {
  const { loadExecutionPlan, planFileRelative } = await import("./executionPlan.js");
  const disk = await loadExecutionPlan(threadId);
  if (!disk?.steps?.length) return null;

  const plan = {
    id: disk.threadId ?? threadId,
    title: disk.title ?? "Task plan",
    steps: disk.steps.map((s) => ({
      id: String(s.id),
      label: s.label,
      status: VALID_STATUS.has(s.status) ? s.status : "pending",
      tool: s.tool ?? null,
      args: s.args ?? null,
    })),
    planFile: planFileRelative(threadId),
    mode: disk.mode ?? "executing",
    created: false,
  };

  ensureSingleActiveStep(plan);
  turnPlans.set(threadId, plan);
  return plan;
}

export function emitPlanEvent(plan, action) {
  const done = plan.steps.filter((s) => s.status === "done").length;
  return {
    type: "plan",
    action: action ?? (plan.created ? "create" : "update"),
    plan: {
      id: plan.id,
      title: plan.title,
      steps: plan.steps.map((s) => ({ ...s })),
      planFile: plan.planFile ?? null,
      mode: plan.mode ?? "executing",
      progress: { done, total: plan.steps.length },
    },
  };
}

export async function syncPlanStep(
  threadId,
  { toolName, phase, succeeded = true, retainPlan = true } = {},
) {
  if (!retainPlan) return null;
  const plan = turnPlans.get(threadId);
  if (!plan?.steps?.length) return null;
  if (plan.mode !== "executing" && plan.mode !== "frozen") return null;
  if (toolName === "update_task_plan" || toolName === "mark_plan_step") return null;

  if (phase === "start") {
    ensureSingleActiveStep(plan);
    await persistPlan(threadId, plan);
    turnPlans.set(threadId, plan);
    return emitPlanEvent(plan, "update");
  }

  if (phase === "done" && succeeded) {
    const current = getCurrentPlanStep(threadId);
    if (!current) return null;
    const { classifyPlanStepLabel } = await import("./planStepGates.js");
    const kind = classifyPlanStepLabel(current.label);

    let shouldAdvance = false;
    if (kind === "setup") {
      shouldAdvance = toolName === "run_bash";
    } else if (ADVANCE_ON_SUCCESS_TOOLS.has(toolName)) {
      shouldAdvance = true;
    }

    if (shouldAdvance) {
      completeActiveStepAndAdvance(plan);
      await persistPlan(threadId, plan);
      turnPlans.set(threadId, plan);
      return emitPlanEvent(plan, "advance");
    }
  }

  return null;
}

export function planStepHint(threadId) {
  const plan = turnPlans.get(threadId);
  if (!plan?.steps?.length) return "";

  const done = plan.steps.filter((s) => s.status === "done").length;
  const total = plan.steps.length;
  const current = getCurrentPlanStep(threadId);

  if (isPlanComplete(threadId)) {
    return `\n\nTask plan complete (${done}/${total}). Proceed to hand off if verification passed.`;
  }

  const pending = plan.steps
    .filter((s) => s.status === "pending")
    .slice(0, 2)
    .map((s) => `${s.id}. ${s.label}`)
    .join("; ");

  return (
    `\n\nTask plan ${done}/${total} done.` +
    (current
      ? ` Now working on: ${current.id}. ${current.label}` +
        (pending ? `. Up next: ${pending}` : "")
      : "") +
    " Steps auto-advance on successful write_file/search_replace/verify_project � call mark_plan_step only to skip or after write_file SKIP (already exists)."
  );
}

/**
 * Fill missing step_id from the active plan step when the model omits it.
 * @param {string} threadId
 * @param {{ step_id?: string, status?: string }} partial
 */
export function inferMarkPlanStepDefaults(threadId, partial = {}) {
  const out = { ...partial };
  if (!out.step_id && out.status) {
    const current = getCurrentPlanStep(threadId);
    if (current?.id) out.step_id = String(current.id);
  }
  return out;
}

export function hasValidPlan(threadId) {
  const plan = turnPlans.get(threadId);
  return Boolean(plan?.steps?.length >= 2);
}

export function planProgressSummary(threadId) {
  const plan = turnPlans.get(threadId);
  if (!plan) return null;
  const done = plan.steps.filter((s) => s.status === "done").length;
  return `${done}/${plan.steps.length}`;
}

export function isPlanComplete(threadId) {
  const plan = turnPlans.get(threadId);
  if (!plan?.steps?.length) return true;
  return plan.steps.every(
    (s) => s.status === "done" || s.status === "skipped",
  );
}

export async function reopenStaleCompletedPlan(threadId, message, { persist = true } = {}) {
  const {
    userIndicatesStalePlan,
    userWantsFreshResearch,
    planExpectsCodeChanges,
    classifyPlanStepLabel,
  } = await import("./planStepGates.js");

  const plan = turnPlans.get(threadId);
  if (!plan?.steps?.length || !isPlanComplete(threadId)) return null;
  if (!userIndicatesStalePlan(message)) return null;
  if (!planExpectsCodeChanges(threadId)) return null;

  const freshResearch = userWantsFreshResearch(message);

  for (const step of plan.steps) {
    if (step.status === "skipped") continue;
    const kind = classifyPlanStepLabel(step.label);
    if (kind === "research" && !freshResearch) continue;
    step.status = "pending";
  }

  ensureSingleActiveStep(plan);
  if (persist) {
    await persistPlan(threadId, plan);
  }
  turnPlans.set(threadId, plan);
  return plan;
}

export function getIncompleteSteps(threadId) {
  const plan = turnPlans.get(threadId);
  if (!plan?.steps?.length) return [];
  return plan.steps.filter(
    (s) => s.status !== "done" && s.status !== "skipped",
  );
}

export function planStatusBlock(threadId) {
  const plan = turnPlans.get(threadId);
  if (!plan?.steps?.length) return "";

  const current = getCurrentPlanStep(threadId);
  const progress = planProgressSummary(threadId);

  const lines = plan.steps.map((s) => {
    const icon =
      s.status === "done"
        ? "[x]"
        : s.status === "in_progress"
          ? "[?]"
          : s.status === "skipped"
            ? "[-]"
            : "[ ]";
    const marker = s.id === current?.id ? " ? CURRENT" : "";
    return `${icon} ${s.id}. ${s.label}${marker}`;
  });

  const criteria = acceptanceCriteriaBlock(threadId);
  return [
    ...(criteria ? [criteria, ""] : []),
    `Task plan (${progress} complete) � work through steps in order:`,
    ...(plan.planFile ? [`Plan file: ${plan.planFile}`] : []),
    ...(current
      ? [`Active step: ${current.id}. ${current.label}`]
      : []),
    ...lines,
    plan.mode === "frozen"
      ? "Use mark_plan_step to sync step status (plan is frozen � no update_task_plan during execute)."
      : "After each major step, call mark_plan_step or update_task_plan to sync statuses.",
  ].join("\n");
}

export function serializeTaskPlan(threadId) {
  const plan = turnPlans.get(threadId);
  if (!plan?.steps?.length) return null;
  const done = plan.steps.filter((s) => s.status === "done").length;
  return {
    id: plan.id,
    title: plan.title,
    steps: plan.steps.map((s) => ({ ...s })),
    planFile: plan.planFile ?? null,
    mode: plan.mode ?? "executing",
    progress: { done, total: plan.steps.length },
  };
}
