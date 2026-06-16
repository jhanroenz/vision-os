import { getWrittenPaths, hadSuccessfulTool } from "./verification.js";

/** Generic update_task_plan example — no project-specific names. */
export const UPDATE_TASK_PLAN_SCHEMA_EXAMPLE =
  '{"tool":"update_task_plan","args":{"title":"<short title from user request>","steps":[' +
  '{"id":"1","label":"create project folder and scaffold source files","status":"pending"},' +
  '{"id":"2","label":"implement core features","status":"pending"},' +
  '{"id":"3","label":"verify_project on locked root","status":"pending"}]}}';

export function buildUpdateTaskPlanSchemaError() {
  return (
    "update_task_plan requires ≥2 steps with id, label, and status.\n" +
    "Do NOT nest update_task_plan inside run_bash — call it directly.\n" +
    `Example: ${UPDATE_TASK_PLAN_SCHEMA_EXAMPLE}`
  );
}

export function buildUpdateTaskPlanLoopNudge() {
  return (
    "STOP retrying malformed update_task_plan calls.\n" +
    "Call update_task_plan directly (not inside run_bash) with ≥2 steps:\n" +
    UPDATE_TASK_PLAN_SCHEMA_EXAMPLE
  );
}

export const GREENFIELD_EXECUTE_NEXT_STEPS =
  "Next: update_task_plan (≥2 steps, last = verify), then write_file for each file your plan lists.";

export function buildRepeatedSearchFilesNudge(query, planStepLabel = null) {
  const stepHint = planStepLabel
    ? `Current plan step: ${planStepLabel}. `
    : "";
  return (
    `Repeated search_files with query "${query}" — empty scan confirms greenfield (no matching files yet).\n` +
    `Phase 1 AWARENESS is complete. ${stepHint}Call update_task_plan now (≥2 steps, last = verify), ` +
    `then write_file for each planned file with full content.`
  );
}

const MENTIONED_FILE_RE =
  /\b(?:[\w.-]+\/)*[\w.-]+\.(?:html|css|js|jsx|ts|tsx|vue|svelte|json|py|rs|go|md|toml|yaml|yml)\b/gi;

export function extractMentionedFilePaths(text) {
  const seen = new Set();
  for (const match of String(text ?? "").matchAll(MENTIONED_FILE_RE)) {
    const normalized = match[0].replace(/^\.\//, "").toLowerCase();
    seen.add(normalized);
  }
  return [...seen];
}

function wasPathSuccessfullyWritten(toolEvents, filePath) {
  const target = String(filePath).replace(/\\/g, "/").toLowerCase();
  const base = target.includes("/") ? target.slice(target.lastIndexOf("/") + 1) : target;
  for (let i = 0; i < toolEvents.length; i++) {
    const event = toolEvents[i];
    if (event.type !== "tool_call" || event.name !== "write_file") continue;
    const path = String(event.args?.path ?? "")
      .replace(/\\/g, "/")
      .toLowerCase();
    if (path !== target && !path.endsWith(`/${base}`)) continue;
    const result = toolEvents[i + 1];
    if (
      result?.type === "tool_result" &&
      result.name === "write_file" &&
      /^STATUS: SUCCESS/m.test(String(result.content ?? ""))
    ) {
      return true;
    }
  }
  return false;
}

export function claimedHandoffWithUnwrittenFiles(toolEvents, reply, reasoning = "") {
  const text = `${reply}\n${reasoning}`;
  if (!/\b(?:created|wrote|written|necessary files|files:)\b/i.test(text)) return false;
  const mentioned = extractMentionedFilePaths(text);
  if (!mentioned.length) return false;
  return mentioned.some((f) => !wasPathSuccessfullyWritten(toolEvents, f));
}

export function buildHandoffIncompleteNudge(toolEvents, reply, reasoning = "") {
  const mentioned = extractMentionedFilePaths(`${reply}\n${reasoning}`);
  const missing = mentioned.filter((f) => !wasPathSuccessfullyWritten(toolEvents, f));
  const written = getWrittenPaths(toolEvents);
  let content =
    "Your handoff claims files that were NOT successfully written this turn.\n";
  if (written.length) {
    content += `Successful writes so far: ${written.join(", ")}.\n`;
  } else {
    content += "No write_file returned STATUS: SUCCESS yet.\n";
  }
  if (missing.length) {
    content += `Call write_file with full content for each missing file before handoff: ${missing.join(", ")}.`;
  } else {
    content += "Call write_file with full content for each file you claimed before handoff.";
  }
  return content;
}

export const GREENFIELD_NO_ROOT_LOCK_HINT =
  "Call inspect_codebase to lock a project folder, OR for greenfield work write source files under a dedicated project folder after awareness is complete.";

export function isPrematureHandoffReply(reply, toolEvents) {
  const text = String(reply ?? "").trim();
  const looksLikeHandoff =
    /^\[Hand off summary\]/im.test(text) ||
    /^\[EXECUTION LOCK/im.test(text) ||
    /NOW EXECUTING \(locked\)/m.test(text);
  if (!looksLikeHandoff) return false;
  return !hadSuccessfulTool(toolEvents, "write_file");
}

export function buildExecuteLockedStepNudge(currentStep, writtenPaths = []) {
  let content =
    "STOP sending handoff summaries or repeating system briefs — required files are not on disk yet.\n";
  if (currentStep?.label) {
    content += `Execute the locked plan step: ${currentStep.id}. ${currentStep.label}\n`;
  }
  if (writtenPaths.length) {
    content += `Written so far: ${writtenPaths.join(", ")}\n`;
  }
  content +=
    "Next: one run_bash or write_file call with a valid relative path and full content — not mark_plan_step.";
  return content;
}

export function buildMarkPlanStepHardCapNudge(currentStep) {
  return (
    "STOP repeating mark_plan_step — the active step has no successful tool evidence yet.\n" +
    (currentStep
      ? `Complete this step first: ${currentStep.id}. ${currentStep.label}\n`
      : "") +
    "Next: run_bash (mkdir/init) or write_file (full file content). Plan steps auto-advance on SUCCESS."
  );
}

export const GREENFIELD_BRIEF_LINES = [
  "",
  "GREENFIELD SCAFFOLD — no app source files on disk yet (Phase 1 AWARENESS complete).",
  "Pick one project folder name from the user's request — do not scatter app files at workspace root unless they asked for root-level files.",
  "CREATE: run_bash mkdir -p <folder> then write_file each new source file under that folder (write_file auto-creates parent dirs).",
  "Call inspect_codebase on your project folder to lock the project root before verify_project.",
  "Do not repeat search_files for files that do not exist yet.",
  GREENFIELD_EXECUTE_NEXT_STEPS,
];

export function userRequestedRootLevelScaffold(message) {
  return /\b(at (?:the )?workspace root|at (?:the )?root|root level|workspace root|top[- ]level of (?:the )?workspace)\b/i.test(
    String(message ?? ""),
  );
}

export function shouldBlockGreenfieldRootWrite(message, filePath, preflight) {
  if (!preflight?.greenfieldScaffold) return false;
  if (userRequestedRootLevelScaffold(message)) return false;
  const p = String(filePath ?? "").replace(/\\/g, "/").trim();
  if (!p || p.includes("/")) return false;
  return /\.(html|css|js|jsx|ts|tsx|vue|svelte|json|toml|yaml|yml|md)$/i.test(p);
}

export function buildGreenfieldRootWriteBlockedMessage(filePath) {
  return (
    `Blocked write_file at workspace root ("${filePath}").\n` +
    `Pick a project subfolder, run_bash mkdir -p <folder>, then write_file under that folder.\n` +
    `Only write at workspace root when the user explicitly asked for root-level files.`
  );
}
