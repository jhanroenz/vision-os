const VALID_STATUS = new Set(["pending", "in_progress", "done", "skipped"]);

const STATUS_ALIASES = {
  complete: "done",
  completed: "done",
  finished: "done",
  todo: "pending",
  open: "pending",
  active: "in_progress",
  running: "in_progress",
  skip: "skipped",
  cancelled: "skipped",
  canceled: "skipped",
};

function normalizeStatus(value) {
  if (value == null || value === "") return undefined;
  const raw = String(value).trim().toLowerCase();
  if (VALID_STATUS.has(raw)) return raw;
  return STATUS_ALIASES[raw];
}

function stepFromString(text, index) {
  const label = String(text ?? "").trim();
  if (!label) return null;
  return {
    id: String(index + 1),
    label,
    status: index === 0 ? "in_progress" : "pending",
  };
}

function stepFromObject(raw, index) {
  if (raw == null) return null;
  if (typeof raw === "string") return stepFromString(raw, index);

  if (typeof raw !== "object") return null;

  const label =
    raw.label ??
    raw.title ??
    raw.name ??
    raw.description ??
    raw.text ??
    raw.step ??
    "";
  const trimmed = String(label).trim();
  if (!trimmed) return null;

  const id = String(raw.id ?? raw.step_id ?? raw.stepId ?? index + 1);
  const status = normalizeStatus(raw.status ?? raw.state);
  const step = { id, label: trimmed };
  if (status) step.status = status;
  return step;
}

function stepsFromObjectMap(obj) {
  const entries = Object.entries(obj ?? {});
  if (!entries.length) return [];
  return entries
    .sort(([a], [b]) => {
      const na = Number(a);
      const nb = Number(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return String(a).localeCompare(String(b));
    })
    .map(([key, value], index) => {
      if (typeof value === "string") {
        return stepFromString(value, index) ?? stepFromString(key, index);
      }
      const step = stepFromObject(value, index);
      if (step && !value?.id && !Number.isNaN(Number(key))) {
        step.id = String(key);
      }
      return step;
    })
    .filter(Boolean);
}

function normalizeStepsInput(steps) {
  if (steps == null) return [];

  if (typeof steps === "string") {
    const lines = steps
      .split(/\n+/)
      .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
      .filter(Boolean);
    return lines.map((line, index) => stepFromString(line, index)).filter(Boolean);
  }

  if (Array.isArray(steps)) {
    return steps.map((item, index) => stepFromObject(item, index)).filter(Boolean);
  }

  if (typeof steps === "object") {
    return stepsFromObjectMap(steps);
  }

  return [];
}

function ensureVerifyStep(steps) {
  const out = [...steps];
  const hasVerify = out.some((s) =>
    /\b(verify|validation|test|build|lint)\b/i.test(s.label),
  );
  if (!hasVerify) {
    out.push({
      id: String(out.length + 1),
      label: "Verify project (verify_project)",
      status: "pending",
    });
  }
  return out;
}

function renumberSteps(steps) {
  return steps.map((step, index) => ({
    ...step,
    id: String(index + 1),
    status:
      step.status ??
      (index === 0 ? "in_progress" : "pending"),
  }));
}

/**
 * Coerce model output into update_task_plan args the Zod schema accepts.
 * @returns {{ title?: string, steps: Array<{ id: string, label: string, status?: string }> } | null}
 */
export function normalizeUpdateTaskPlanArgs(args) {
  if (args == null) return null;

  const copy = typeof args === "object" ? { ...args } : {};
  let title = copy.title ?? copy.name ?? copy.plan_title;
  if (title != null) title = String(title).trim();

  let rawSteps = copy.steps ?? copy.plan ?? copy.checklist ?? copy.items ?? copy.tasks;
  if (!rawSteps && Array.isArray(copy.plan_steps)) {
    rawSteps = copy.plan_steps;
  }

  let steps = normalizeStepsInput(rawSteps);

  if (steps.length === 1) {
    steps = ensureVerifyStep(steps);
  } else if (steps.length >= 2) {
    steps = ensureVerifyStep(steps);
  }

  steps = renumberSteps(steps);

  if (steps.length < 2) return null;

  return {
    ...(title ? { title } : {}),
    steps,
  };
}
