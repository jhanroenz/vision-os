import { getTaskPlan, getCurrentPlanStep } from "./taskPlan.js";
import { isPlanFrozen } from "./planFreeze.js";
import {
  hadFilesystemCreateSkip,
  hadSuccessfulWebSearch,
  hadSuccessfulVerify,
  hadSuccessfulTool,
  hasSuccessfulVerification,
  madeCodeChanges,
} from "./verification.js";
import { hasChecklistEvidence } from "./verificationPlan.js";

const STALE_PLAN_PATTERNS = [
  /\bno changes?( happened| were made| saved| applied)?\b/i,
  /\bnothing (was )?changed\b/i,
  /\bdidn'?t (save|apply|change|write|update)\b/i,
  /\blast run (didn'?t|failed|did not|never)\b/i,
  /\b(not|never|wasn'?t) saved\b/i,
  /\bstill (hasn'?t|has not|no changes?)\b/i,
  /\bredo (the )?(steps|work|changes|implementation)\b/i,
  /\bensure you (actually )?do (the )?(code )?changes?\b/i,
  /\bweren'?t saved\b/i,
  /\bnever saved\b/i,
  /\bwithout (any )?changes?\b/i,
  /\bchanges? (didn'?t|did not|never) happen\b/i,
];

const FRESH_RESEARCH_PATTERNS = [
  /\bsearch the web\b/i,
  /\bweb search\b/i,
  /\blook up (references?|designs?|examples?)\b/i,
  /\bfind reference\b/i,
  /\bget reference\b/i,
];

const RESEARCH_PATTERN =
  /\b(analy(?:z|s)e|research|search results?|review patterns?|gather|study|investigate)\b/i;
const READ_UNDERSTAND_PATTERN = /\b(read|understand|examine|review)\b/i;
const CODE_ANALYSIS_PATTERN =
  /\banaly(?:z|s)e\b.*\b(logic|code|bug|issue|behavior|calculator|dependencies|root cause)\b/i;
const EXPLORE_STEP_PATTERN =
  /\b(semantic_search|grep_code|grep|glob_files|inspect_codebase|codebase|locate|find where|search codebase|search for modules|search for functions)\b/i;
const IMPLEMENTATION_PATTERN =
  /\b(refine|implement|enhance|write|edit|update|create|add|css|component|layout|style|polish|animation|token|shell|filler|ui|design|modify|change)\b/i;
const VERIFY_PATTERN =
  /\b(verify|validation|test|build quality|visual quality|lint|check)\b/i;
const SETUP_STEP_PATTERN =
  /\b(mkdir|scaffold(?:ing)?|project folder|create (?:the )?(?:project )?(?:folder|directory)|bootstrap|folder structure|initialize (?:the )?project|set up (?:the )?project|prepare (?:the )?(?:project )?directory)\b/i;
const SETUP_INCLUDES_FILE_WORK =
  /\b(write|implement|add features|source files|entry files|components?|\.(?:html|css|js|ts|vue|jsx|tsx))\b/i;

/** @returns {"research" | "explore" | "implementation" | "verify" | "setup" | "other"} */
export function classifyPlanStepLabel(label) {
  const text = String(label ?? "");
  if (SETUP_STEP_PATTERN.test(text) && !SETUP_INCLUDES_FILE_WORK.test(text)) {
    return "setup";
  }
  const isExplore = EXPLORE_STEP_PATTERN.test(text);
  const isResearch = RESEARCH_PATTERN.test(text);
  const isImplementation = IMPLEMENTATION_PATTERN.test(text);
  const isVerify = VERIFY_PATTERN.test(text) && !isImplementation;
  const hasEditVerb =
    /\b(refine|implement|enhance|write|edit|update|create|add|modify|change)\b/i.test(
      text,
    );

  if (isVerify) return "verify";
  if (isExplore && !hasEditVerb) return "explore";
  if (
    READ_UNDERSTAND_PATTERN.test(text) &&
    !/\b(implement|write|create|update)\b/i.test(text)
  ) {
    return "explore";
  }
  if (CODE_ANALYSIS_PATTERN.test(text)) return "explore";
  if (isResearch && !hasEditVerb) return "research";
  if (isImplementation) return "implementation";
  if (isResearch) return "research";
  return "other";
}

export function planExpectsCodeChanges(threadId) {
  const plan = getTaskPlan(threadId);
  if (!plan?.steps?.length) return false;
  return plan.steps.some(
    (s) =>
      s.status !== "skipped" &&
      classifyPlanStepLabel(s.label) === "implementation",
  );
}

/**
 * @returns {{ allowed: boolean, message?: string }}
 */
export function checkPlanStepDoneGate(threadId, stepId, status, toolEvents, userMessage = "") {
  if (status !== "done") return { allowed: true };

  const plan = getTaskPlan(threadId);
  if (!plan?.steps?.length) return { allowed: true };

  const step =
    plan.steps.find((s) => s.id === String(stepId)) ??
    getCurrentPlanStep(threadId);
  if (!step) {
    return {
      allowed: false,
      message:
        `Blocked mark_plan_step: step "${stepId}" not found in the active plan.\n` +
        `Use the step id from update_task_plan.`,
    };
  }

  if (isPlanFrozen(threadId)) {
    const current = getCurrentPlanStep(threadId);
    if (
      current &&
      String(stepId) !== String(current.id) &&
      (status === "done" || status === "in_progress")
    ) {
      return {
        allowed: false,
        message:
          `Blocked mark_plan_step: execution is locked on step ${current.id} ("${current.label}").\n` +
          `Finish step ${current.id} with a tool before changing step ${stepId}.`,
      };
    }
  }

  const kind = classifyPlanStepLabel(step.label);

  if (kind === "research" && !hadSuccessfulWebSearch(toolEvents)) {
    return {
      allowed: false,
      message:
        `Blocked mark_plan_step: step "${step.id}. ${step.label}" requires research first.\n` +
        `Call web_search and review the results (including fetched page content) before marking this step done.`,
    };
  }

  const exploreTools = [
    "search_files",
    "semantic_search",
    "grep_code",
    "glob_files",
    "inspect_codebase",
    "detect_stack",
    "inspect_ast",
    "list_directory",
    "read_file",
    "read_files",
  ];
  if (kind === "explore" && !hadSuccessfulTool(toolEvents, exploreTools)) {
    return {
      allowed: false,
      message:
        `Blocked mark_plan_step: step "${step.id}. ${step.label}" requires codebase search or read first.\n` +
        `Use semantic_search, grep_code, or inspect_ast successfully (answer from AST when sufficient; read_file only if exact source needed), then mark done.`,
    };
  }

  if (
    kind === "setup" &&
    !hadSuccessfulTool(toolEvents, ["run_bash", "write_file", "search_replace"])
  ) {
    return {
      allowed: false,
      message:
        `Blocked mark_plan_step: step "${step.id}. ${step.label}" requires project setup first.\n` +
        `Call run_bash (mkdir/init) or write_file (parents auto-created), then mark this step done.\n` +
        `Next action: run one setup tool — do not repeat mark_plan_step without a new tool result.`,
    };
  }

  if (kind === "implementation" && status === "done") {
    if (hadFilesystemCreateSkip(toolEvents)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      message:
        `Blocked mark_plan_step: step "${step.id}. ${step.label}" auto-advances on successful write_file/search_replace.\n` +
        `Call write_file or search_replace for this step — use mark_plan_step only after STATUS: SKIP (already exists).`,
    };
  }

  if (kind === "verify") {
    const verified =
      hadSuccessfulVerify(toolEvents) ||
      hasChecklistEvidence(threadId, toolEvents) ||
      (madeCodeChanges(toolEvents) &&
        hasSuccessfulVerification(toolEvents, threadId));
    if (!verified) {
      return {
        allowed: false,
        message:
          `Blocked mark_plan_step: step "${step.id}. ${step.label}" requires verification.\n` +
          `Run check_syntax on written files; on FAIL use search_replace/write_file to fix, then re-run. ` +
          `Complete the verification checklist and confirm acceptance criteria before marking this step done.`,
      };
    }
  }

  if (
    kind === "other" &&
    !hadSuccessfulTool(toolEvents, [
      "write_file",
      "search_replace",
      "apply_template",
      "verify_project",
      "web_search",
      "run_bash",
      "search_files",
      "read_file",
      "read_files",
      "list_directory",
      "semantic_search",
      "grep_code",
      "glob_files",
      "inspect_codebase",
      "inspect_ast",
    ])
  ) {
    return {
      allowed: false,
      message:
        `Blocked mark_plan_step: step "${step.id}. ${step.label}" has no completed work yet.\n` +
        `Use tools to finish the step, then mark it done.`,
    };
  }

  return { allowed: true };
}

export function userIndicatesStalePlan(message) {
  return STALE_PLAN_PATTERNS.some((p) => p.test(String(message ?? "")));
}

export function userWantsFreshResearch(message) {
  return FRESH_RESEARCH_PATTERNS.some((p) => p.test(String(message ?? "")));
}

export function buildPlanStepLoopRecoveryBrief(threadId, toolEvents, lastBlockMessage = "") {
  const current = getCurrentPlanStep(threadId);
  const stepId = current?.id ?? "?";
  const kind = current ? classifyPlanStepLabel(current.label) : "other";

  const lines = [
    "PLAN STEP LOOP — stop repeating mark_plan_step with the same args.",
    lastBlockMessage ? `Last block: ${String(lastBlockMessage).split("\n")[0]}` : "",
    current ? `Active step: ${stepId}. ${current.label}` : "No active step.",
    `Use exact JSON: {"tool":"mark_plan_step","args":{"step_id":"${stepId}","status":"done"}}`,
  ];

  if (kind === "setup") {
    lines.push(
      "Next action: run_bash (mkdir/init) or write_file, then mark_plan_step done once.",
      "Plan auto-advances on successful run_bash for setup steps — you may not need mark_plan_step at all.",
    );
  } else if (kind === "implementation") {
    lines.push(
      "Next action: write_file or search_replace (STATUS: SUCCESS), OR if write_file was SKIP (already exists), mark_plan_step done once.",
      "Plan auto-advances on successful write_file — you may not need mark_plan_step at all.",
    );
  } else if (kind === "verify") {
    lines.push("Next action: check_syntax + verify_project or run_check, then mark_plan_step done.");
  } else if (kind === "research") {
    lines.push("Next action: web_search, then mark_plan_step done.");
  } else if (kind === "explore") {
    lines.push("Next action: inspect_ast or read_file, then mark_plan_step done.");
  } else {
    lines.push("Next action: complete the step with a tool, then mark_plan_step once.");
  }

  return lines.filter(Boolean).join("\n");
}

export function buildStalePlanReopenBrief(plan, message) {
  const current = plan.steps.find((s) => s.status === "in_progress");
  const done = plan.steps.filter((s) => s.status === "done").length;
  const total = plan.steps.length;
  const freshResearch = userWantsFreshResearch(message);

  return (
    "STALE PLAN RESET — the saved task plan was marked complete but Master Jan reports " +
    "no code changes were saved from the prior run.\n" +
    `Plan reopened (${done}/${total} done). ` +
    (freshResearch
      ? "Start with web_search for fresh reference material, then implement with write_file."
      : "Skip re-research if prior results are still in context; focus on write_file/search_replace.") +
    (current
      ? `\nActive step: ${current.id}. ${current.label}`
      : "") +
    "\nDo NOT hand off until implementation steps succeed and verify_project passes."
  );
}
