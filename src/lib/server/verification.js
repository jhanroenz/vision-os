import {
  detectProjectRoot,
  fileExists,
} from "./codebase/context.js";
import { resolveSafePath } from "./workspace.js";
import { hasPathWarningsInResults, hasUnresolvedPathWarnings } from "./fileContext.js";
import {
  extractVerificationErrors,
  buildVerifyFailureGuidanceFromContent,
} from "./verificationDiagnostics.js";
import path from "node:path";
import fs from "node:fs/promises";
import { planExpectsCodeChanges } from "./planStepGates.js";
import { requiresAgentTaskPlan } from "./knowledgeQA.js";
import { getExecutionPhase } from "./executionOrder.js";
import { isPlanFrozen } from "./planFreeze.js";
import {
  evaluateVerificationEvidence,
  getVerificationChecklist,
  buildChecklistStatusBlock,
} from "./verificationPlan.js";
import { isPlanTodoFilePath } from "./planFreeze.js";
import {
  isToolRecitationHandoff,
  buildHandoffRecitationRetryMessage,
} from "./handoffBrief.js";

export { extractVerificationErrors } from "./verificationDiagnostics.js";

/** Last verify_project OVERALL: PASS per thread (survives across turns). */
const threadVerifyPass = new Map();

const VERIFY_PASS = /OVERALL:\s*PASS/i;
const VERIFY_FAIL = /OVERALL:\s*FAIL/i;
const BASH_SUCCESS = /RESULT:\s*SUCCESS/i;
const BASH_FAILED = /RESULT:\s*FAILED/i;

const VERIFY_COMMAND_PATTERNS =
  /\b(npm test|npm run (?:test|build|lint|check|typecheck|verify)|pnpm (?:test|run)|yarn test|cargo test|cargo check|go test|pytest|python -m pytest|vitest|jest)\b/i;

export function parseBashExitCode(content) {
  if (!content) return null;
  const resultMatch = content.match(/RESULT:\s*(SUCCESS|FAILED)\s*\(exit\s+(\d+)\)/i);
  if (resultMatch) {
    return Number(resultMatch[2]);
  }
  const legacy = content.match(/exit code:\s*(\d+)/i);
  return legacy ? Number(legacy[1]) : null;
}

export function isVerificationCommand(command) {
  return VERIFY_COMMAND_PATTERNS.test(String(command ?? ""));
}

function getToolCalls(toolEvents) {
  return toolEvents.filter((e) => e.type === "tool_call" || e.name);
}

export function usedVerifyProject(toolEvents) {
  return toolEvents.some((e) => e.name === "verify_project");
}

const WRITE_TOOLS = new Set(["write_file", "search_replace"]);

export function usedWriteFile(toolEvents) {
  return toolEvents.some((e) => WRITE_TOOLS.has(e.name));
}

export function usedApplyTemplate(toolEvents) {
  return toolEvents.some((e) => e.name === "apply_template");
}

export function isSuccessfulToolResult(event) {
  if (event?.type !== "tool_result") return false;
  const content = String(event.content ?? "");
  if (/^STATUS: SUCCESS/m.test(content)) return true;

  const name = event.name;
  if (name === "read_file") {
    return (
      (/^---\s+.+\s+---/m.test(content) || /^=== FILE:/m.test(content)) &&
      !/File not found:/i.test(content)
    );
  }
  if (name === "read_files") {
    return /RESULT:\s*SUCCESS/i.test(content);
  }
  if (name === "list_directory") {
    return (
      content.trim().length > 0 &&
      !/Directory not found:/i.test(content) &&
      !/^STATUS: (FAIL|BLOCKED)/m.test(content)
    );
  }
  if (name === "inspect_codebase") {
    return /Project root:/i.test(content);
  }
  if (name === "detect_stack") {
    return /\[Project stack —/i.test(content);
  }
  if (name === "inspect_ast") {
    return /RESULT:\s*SUCCESS/i.test(content);
  }
  if (name === "search_files") {
    return /RESULT:\s*SUCCESS/i.test(content);
  }
  if (name === "semantic_search" || name === "grep_code" || name === "glob_files") {
    return (
      content.trim().length > 0 &&
      !/^Blocked /i.test(content) &&
      !/^PATH REJECTED/i.test(content) &&
      !/^STATUS: (FAIL|BLOCKED)/m.test(content)
    );
  }
  return false;
}

export function hadSuccessfulTool(toolEvents, toolNames) {
  const names = new Set(
    (Array.isArray(toolNames) ? toolNames : [toolNames]).map(String),
  );
  return toolEvents.some(
    (e) => e.type === "tool_result" && names.has(e.name) && isSuccessfulToolResult(e),
  );
}

export function hadSuccessfulWrite(toolEvents) {
  return hadSuccessfulTool(toolEvents, [
    "write_file",
    "search_replace",
    "apply_template",
  ]);
}

/** write_file blocked with filesystem awareness — path already EXISTS (create intent). */
export function hadFilesystemCreateSkip(toolEvents, path = null) {
  const target = path ? String(path).replace(/\\/g, "/").replace(/^\.\//, "") : null;

  for (const event of toolEvents ?? []) {
    if (event?.type !== "tool_result" || event.name !== "write_file") continue;
    const content = String(event.content ?? "");
    if (!/STATUS:\s*SKIP/i.test(content)) continue;
    if (!/filesystem awareness.*already exists/i.test(content)) continue;
    if (!target) return true;
    if (content.includes(`"${target}"`) || content.includes(`'${target}'`)) {
      return true;
    }
    if (content.includes(target)) return true;
  }
  return false;
}

/** Evidence that an implementation plan step was satisfied this turn. */
export function hadImplementationEvidence(toolEvents) {
  return hadSuccessfulWrite(toolEvents) || hadFilesystemCreateSkip(toolEvents);
}

export function hadSuccessfulWebSearch(toolEvents) {
  return hadSuccessfulTool(toolEvents, "web_search");
}

export function hadSuccessfulVerify(toolEvents) {
  return hadSuccessfulTool(toolEvents, "verify_project");
}

export function madeCodeChanges(toolEvents) {
  return hadSuccessfulWrite(toolEvents);
}

export function getWrittenPaths(toolEvents) {
  return getSuccessfulWrites(toolEvents).map((w) => w.path);
}

function getSuccessfulWrites(toolEvents) {
  const writes = [];
  for (let i = 0; i < toolEvents.length; i++) {
    const event = toolEvents[i];
    if (event.type !== "tool_call" || !WRITE_TOOLS.has(event.name)) {
      continue;
    }
    const result = toolEvents[i + 1];
    if (!isSuccessfulToolResult(result)) continue;
    const p = event.args?.path ?? event.args?.target_file;
    if (p) writes.push({ index: i, path: p });
  }
  return writes;
}

function findLastVerifyPassIndex(toolEvents) {
  for (let i = toolEvents.length - 1; i >= 0; i--) {
    const event = toolEvents[i];
    if (event.type !== "tool_result" || event.name !== "verify_project") continue;
    if (VERIFY_PASS.test(event.content ?? "")) return i;
  }
  return -1;
}

export function hasThreadVerifyPass(threadId) {
  return threadId ? threadVerifyPass.has(threadId) : false;
}

export function recordThreadVerifyPass(threadId, projectRoot = null) {
  if (!threadId) return;
  threadVerifyPass.set(threadId, {
    at: Date.now(),
    projectRoot: projectRoot ?? null,
  });
}

export function clearThreadVerifyPass(threadId) {
  if (!threadId) return;
  threadVerifyPass.delete(threadId);
}

/** For tests — reset per-thread verify memory. */
export function clearThreadVerifyPassForTest(threadId) {
  clearThreadVerifyPass(threadId);
}

/**
 * Plan checklist writes (.jarvis/plans/*.json) after OVERALL: PASS do not need
 * read_file + verify_project again (same turn or later turn).
 */
export function shouldSkipPostWriteVerification(toolEvents, threadId = null) {
  const writes = getSuccessfulWrites(toolEvents);
  if (!writes.length) return false;

  const verifyIdx = findLastVerifyPassIndex(toolEvents);

  if (verifyIdx >= 0) {
    const afterVerify = writes.filter((w) => w.index > verifyIdx);
    return (
      afterVerify.length > 0 &&
      afterVerify.every((w) => isPlanTodoFilePath(w.path))
    );
  }

  if (!hasThreadVerifyPass(threadId)) return false;
  return writes.every((w) => isPlanTodoFilePath(w.path));
}

export function syncThreadVerifyFromToolResult(
  threadId,
  toolName,
  content,
  { writtenPath = null } = {},
) {
  if (!threadId) return;
  const text = String(content ?? "");

  if (toolName === "verify_project") {
    if (VERIFY_PASS.test(text)) {
      recordThreadVerifyPass(threadId);
    } else if (VERIFY_FAIL.test(text)) {
      clearThreadVerifyPass(threadId);
    }
    return;
  }

  if (!WRITE_TOOLS.has(toolName)) return;
  if (!/^STATUS: SUCCESS/m.test(text)) return;

  const path =
    writtenPath ??
    text.match(/\b(?:Wrote|written|replaced).*?\bto\s+([^\s\n]+)/i)?.[1];
  if (path && !isPlanTodoFilePath(path)) {
    clearThreadVerifyPass(threadId);
  }
}

export function hasReadBackAfterWrites(toolEvents, threadId = null) {
  if (shouldSkipPostWriteVerification(toolEvents, threadId)) return true;

  const written = getWrittenPaths(toolEvents).filter(
    (p) => !isPlanTodoFilePath(p),
  );
  if (!written.length) return true;

  let lastWriteIndex = -1;
  for (let i = 0; i < toolEvents.length; i++) {
    const event = toolEvents[i];
    if (event.type !== "tool_call" || !WRITE_TOOLS.has(event.name)) {
      continue;
    }
    const result = toolEvents[i + 1];
    if (!isSuccessfulToolResult(result)) continue;
    const p = event.args?.path ?? event.args?.target_file;
    if (p && isPlanTodoFilePath(p)) continue;
    lastWriteIndex = i;
  }
  if (lastWriteIndex < 0) return true;

  for (let i = lastWriteIndex + 1; i < toolEvents.length; i++) {
    const event = toolEvents[i];
    if (event.name !== "read_file") continue;
    const readPath = event.args?.path ?? "";
    if (written.some((w) => readPath === w || readPath.endsWith(`/${w}`))) {
      return true;
    }
  }
  return false;
}

export function getLastVerifyResult(toolEvents) {
  for (let i = toolEvents.length - 1; i >= 0; i--) {
    const event = toolEvents[i];
    if (event.name !== "verify_project" || event.type !== "tool_result") continue;
    const content = event.content ?? "";
    if (VERIFY_PASS.test(content)) return { passed: true, content };
    if (VERIFY_FAIL.test(content)) return { passed: false, content };
  }
  return null;
}

export function getLastBashResult(toolEvents) {
  for (let i = toolEvents.length - 1; i >= 0; i--) {
    const event = toolEvents[i];
    if (event.name !== "run_bash" || event.type !== "tool_result") continue;
    const content = event.content ?? "";
    const exitCode = parseBashExitCode(content);
    const passed = exitCode === 0 || BASH_SUCCESS.test(content);
    const failed = exitCode != null && exitCode !== 0;
    return { passed, failed, exitCode, content };
  }
  return null;
}

export function hadSuccessfulCheckSyntax(toolEvents) {
  return hadSuccessfulTool(toolEvents, "check_syntax");
}

function normalizeWrittenPath(p) {
  return String(p ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

export function hadCheckSyntaxForPaths(paths, toolEvents) {
  if (!paths?.length) return true;
  const needed = new Set(paths.map(normalizeWrittenPath));
  const passed = new Set();

  for (let i = 0; i < toolEvents.length; i++) {
    const event = toolEvents[i];
    if (event.type !== "tool_result" || event.name !== "check_syntax") continue;

    const call = toolEvents
      .slice(0, i)
      .reverse()
      .find((e) => e.type === "tool_call" && e.name === "check_syntax");
    const path = normalizeWrittenPath(call?.args?.path);
    if (!path || !needed.has(path)) continue;

    if (/RESULT:\s*SUCCESS/i.test(event.content ?? "")) {
      passed.add(path);
    } else if (/RESULT:\s*FAILED/i.test(event.content ?? "")) {
      return false;
    }
  }

  return [...needed].every((p) => passed.has(p));
}

export function hasSuccessfulVerification(toolEvents, threadId = null) {
  if (threadId && hasChecklistEvidence(threadId, toolEvents)) {
    return true;
  }

  const verify = getLastVerifyResult(toolEvents);
  if (verify?.passed) return true;

  if (!madeCodeChanges(toolEvents)) return true;

  const written = getWrittenPaths(toolEvents);
  const syntaxOk = hadCheckSyntaxForPaths(written, toolEvents);

  for (let i = toolEvents.length - 1; i >= 0; i--) {
    const event = toolEvents[i];
    if (event.type !== "tool_result") continue;
    if (event.name !== "run_bash" && event.name !== "run_check") continue;

    const call = toolEvents
      .slice(0, i)
      .reverse()
      .find(
        (e) =>
          e.type === "tool_call" &&
          (e.name === "run_bash" || e.name === "run_check") &&
          e.args?.command,
      );
    if (!call || !isVerificationCommand(call.args.command)) continue;
    const exitCode = parseBashExitCode(event.content ?? "");
    if (exitCode === 0) return syntaxOk || !written.length;
  }

  return false;
}

function hasChecklistEvidence(threadId, toolEvents) {
  const ev = evaluateVerificationEvidence(threadId, toolEvents);
  return Boolean(ev?.allRequiredPassed);
}

/**
 * Count how many consecutive trailing verify_project FAIL results exist.
 * Used to detect infinite retry loops and escalate with a diagnostic message.
 */
export function buildVerifyFailureGuidance(toolEvents, projectRoot) {
  const last = getLastVerifyResult(toolEvents);
  if (!last || last.passed) return null;
  return buildVerifyFailureGuidanceFromContent(last.content ?? "", projectRoot);
}

export function countConsecutiveVerifyFail(toolEvents) {
  let count = 0;
  for (let i = toolEvents.length - 1; i >= 0; i--) {
    const e = toolEvents[i];
    if (e.type !== "tool_result") continue;
    if (e.name === "verify_project" && /OVERALL:\s*FAIL/i.test(e.content ?? "")) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

export function hasFailedVerification(toolEvents) {
  const verify = getLastVerifyResult(toolEvents);
  if (verify && !verify.passed) return true;

  const bash = getLastBashResult(toolEvents);
  if (bash?.failed) {
    const call = [...toolEvents]
      .reverse()
      .find((e) => e.name === "run_bash" && e.args?.command);
    if (call && isVerificationCommand(call.args.command)) return true;
    if (usedWriteFile(toolEvents)) return true;
  }

  return false;
}

async function readPackageMeta(projectRoot) {
  const pkgPath = resolveSafePath(path.join(projectRoot, "package.json"));
  if (!(await fileExists(pkgPath))) return null;
  try {
    return JSON.parse(await fs.readFile(pkgPath, "utf-8"));
  } catch {
    return null;
  }
}

export async function buildVerificationCommands(projectRoot, projectType, { checks = "all" } = {}) {
  const commands = [];
  const add = (name, command, timeout = 120) => {
    commands.push({ name, command, timeout });
  };

  if (projectType === "node") {
    const pkg = await readPackageMeta(projectRoot);
    const scripts = pkg?.scripts ?? {};
    const want = (kind) => checks === "all" || checks === kind;

    const hasVue =
      (await fileExists(resolveSafePath(path.join(projectRoot, "src/App.vue")))) ||
      (pkg?.dependencies?.vue ?? pkg?.devDependencies?.vue);

    if (want("lint") && scripts.lint) add("lint", "npm run lint", 90);
    if (want("lint") && scripts["typecheck"]) add("typecheck", "npm run typecheck", 90);
    if (want("lint") && scripts.check && !scripts["typecheck"]) {
      add("check", "npm run check", 90);
    }
    if (want("lint") && !scripts.lint) {
      if (await fileExists(resolveSafePath(path.join(projectRoot, ".eslintrc.cjs"))) ||
          await fileExists(resolveSafePath(path.join(projectRoot, "eslint.config.js")))) {
        add("lint", "npx eslint . --max-warnings 0", 90);
      } else if (hasVue && (await fileExists(resolveSafePath(path.join(projectRoot, "tsconfig.json"))))) {
        add("typecheck", "npx vue-tsc --noEmit", 90);
      }
    }
    if (want("test") && scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
      add("test", "npm test", 120);
    }
    if (want("build") && scripts.build) add("build", "npm run build", 180);

    if (commands.length === 0) {
      if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
        add("test", "npm test", 120);
      } else if (await fileExists(resolveSafePath(path.join(projectRoot, "tsconfig.json")))) {
        add("typecheck", "npx tsc --noEmit", 90);
      } else if (scripts.build) {
        add("build", "npm run build", 180);
      } else if (hasVue) {
        add("build", "npm run build", 180);
      }
    }
  } else if (projectType === "python") {
    if (checks === "all" || checks === "test") {
      if (await fileExists(resolveSafePath(path.join(projectRoot, "pyproject.toml")))) {
        add("pytest", "python -m pytest", 120);
      } else if (await fileExists(resolveSafePath(path.join(projectRoot, "tests")))) {
        add("pytest", "python -m pytest", 120);
      }
    }
    if (checks === "all" || checks === "lint") {
      add("compile", "python -m compileall -q .", 60);
    }
  } else if (projectType === "rust") {
    if (checks === "all" || checks === "lint") add("check", "cargo check", 120);
    if (checks === "all" || checks === "test") add("test", "cargo test", 180);
  } else if (projectType === "go") {
    if (checks === "all" || checks === "lint") add("vet", "go vet ./...", 60);
    if (checks === "all" || checks === "test") add("test", "go test ./...", 120);
  }

  return commands;
}

export async function suggestVerifyCommand(threadId, getThreadCwd, getActiveProjectRoot) {
  const start = getActiveProjectRoot(threadId) ?? getThreadCwd(threadId);
  const detected = await detectProjectRoot(start);
  if (!detected.projectRoot) return null;

  const commands = await buildVerificationCommands(
    detected.projectRoot,
    detected.projectType,
  );
  if (!commands.length) return null;

  return {
    projectRoot: detected.projectRoot,
    command: commands[0].command,
    allCommands: commands.map((c) => c.command),
  };
}

export async function assessCompletionReadiness({
  userMessage,
  reply,
  toolEvents,
  threadId,
  isProjectTask,
  hasValidPlan,
  isPlanComplete,
  getIncompleteSteps,
  getActiveProjectRoot,
}) {
  if (!isProjectTask) {
    return { block: false };
  }

  if (
    requiresAgentTaskPlan(userMessage) &&
    !hasValidPlan(threadId) &&
    !toolEvents.some(
      (e) => e.type === "tool_result" && e.name === "update_task_plan",
    )
  ) {
    const phase = getExecutionPhase(userMessage, toolEvents, threadId);
    if (phase === "plan" || phase === "execute") {
      return {
        block: true,
        phase: "plan",
        statusMessage: "Task plan required before handoff…",
        reason: "plan_required",
        retryMessage:
          "Call update_task_plan now with a numbered checklist (≥2 steps, final step = verify). " +
          "The server blocks run_bash and write_file until the plan exists. Do not reply in plain text yet.",
      };
    }
  }

  if (hasFailedVerification(toolEvents)) {
    const loopCount = countConsecutiveVerifyFail(toolEvents);

    if (loopCount >= 3) {
      return { block: false };
    }

    const projectRoot = getActiveProjectRoot?.(threadId) ?? null;
    const guidance = buildVerifyFailureGuidance(toolEvents, projectRoot);
    const checklistBlock = buildChecklistStatusBlock(threadId, toolEvents);
    const retryMessage =
      loopCount >= 2
        ? "Verification has failed multiple times.\n" +
          "STOP repeating the same check. Read the error output above carefully.\n\n" +
          (checklistBlock ? `${checklistBlock}\n\n` : "") +
          (guidance ? `${guidance}\n\n` : "") +
          "Fix the specific error, re-run the failed checklist steps, then hand off when all required steps pass."
        : (checklistBlock ? `${checklistBlock}\n\n` : "") +
          (guidance ? `${guidance}\n\n` : "") +
          "Verification FAILED. Read the error output, fix with write_file/search_replace or run_bash, " +
          "then re-run the failed verification steps.";

    return {
      block: true,
      phase: "verify",
      statusMessage:
        loopCount >= 2
          ? "Verify loop detected — read error output…"
          : "Verification failed — fixing…",
      reason: "verification_failed",
      retryMessage,
    };
  }

  if (hasUnresolvedPathWarnings(toolEvents)) {
    return {
      block: true,
      phase: "path",
      statusMessage: "File path errors must be fixed first…",
      reason: "path_error",
      retryMessage:
        "PATH REJECTED or WARNING in recent tool results — wrong file location. " +
        "Call inspect_codebase, check File location memory, and rewrite using the correct " +
        "project-prefixed path. If you already fixed paths, call verify_project. " +
        "If stray src/ exists at workspace root, call cleanup_stray_paths then verify again.",
    };
  }

  if (hasValidPlan(threadId) && !isPlanComplete(threadId)) {
    const pending = getIncompleteSteps(threadId);
    const labels = pending.map((s) => s.label).join("; ");
    const written = getWrittenPaths(toolEvents);
    const noSuccessfulWrites =
      planExpectsCodeChanges(threadId) && !hadSuccessfulWrite(toolEvents);
    return {
      block: true,
      phase: noSuccessfulWrites ? "execute" : "plan",
      statusMessage: noSuccessfulWrites
        ? "No successful file writes — write_file required…"
        : "Task plan incomplete — finish locked step before verify…",
      reason: noSuccessfulWrites ? "plan_incomplete_no_writes" : "plan_incomplete",
      retryMessage: noSuccessfulWrites
        ? `CRITICAL: Task plan shows ${pending.length} pending step(s) but ZERO write_file/search_replace succeeded this turn.\n` +
          `Locked step: ${labels || "see plan"}.\n` +
          "Call write_file NOW with full file content. " +
          "Do NOT mark_plan_step done or verify_project until write_file returns STATUS: SUCCESS."
        : `Task plan incomplete (${pending.length} step(s) remaining: ${labels}).\n` +
          (written.length ? `Written so far: ${written.join(", ")}.\n` : "") +
          "Complete the locked step with write_file before verify_project or handoff. " +
          (isPlanFrozen(threadId)
            ? "Plan is frozen — execute the locked step; mark_plan_step only after STATUS: SUCCESS."
            : "Update the plan with update_task_plan if steps changed.") +
          " Do not reply in plain text yet.",
    };
  }

  if (
    madeCodeChanges(toolEvents) &&
    !shouldSkipPostWriteVerification(toolEvents, threadId) &&
    !hasSuccessfulVerification(toolEvents, threadId)
  ) {
    const checklist = getVerificationChecklist(threadId);
    const checklistBlock = buildChecklistStatusBlock(threadId, toolEvents);
    const ev = evaluateVerificationEvidence(threadId, toolEvents);
    let pendingHint;
    if (ev?.hasFailure) {
      pendingHint =
        "A checklist step FAILED. Use search_replace or write_file to fix the exact error from the tool output FIRST, " +
        "then re-run only the failed check. Do not read_file or re-run check_syntax/build without editing the file.";
    } else if (checklist?.steps?.length) {
      pendingHint = "Complete every required step in the verification checklist below.";
    } else {
      pendingHint =
        "Self-check your work (check_syntax on written files, fix any FAIL with search_replace/write_file, " +
        "then run_bash build/lint/test or verify_project).";
    }

    return {
      block: true,
      phase: "verify",
      statusMessage: "Running verification before handoff…",
      reason: "verification_required",
      retryMessage:
        "You changed code but verification is not complete yet. " +
        `${pendingHint} ` +
        (checklistBlock ? `\n\n${checklistBlock}` : ""),
    };
  }

  if (
    hasValidPlan(threadId) &&
    isPlanComplete(threadId) &&
    planExpectsCodeChanges(threadId) &&
    !hadSuccessfulWrite(toolEvents)
  ) {
    return {
      block: true,
      phase: "execute",
      statusMessage: "Plan complete but no file changes…",
      reason: "plan_without_code_changes",
      retryMessage:
        "Your task plan is marked complete but no files were successfully changed this turn. " +
        "Implementation steps require write_file or search_replace with STATUS: SUCCESS. " +
        "If write_file was blocked, call inspect_codebase or read_file first, then retry the edit. " +
        "Do NOT hand off until the planned UI/code changes are saved.",
    };
  }

  if (
    madeCodeChanges(toolEvents) &&
    !shouldSkipPostWriteVerification(toolEvents, threadId) &&
    !hasReadBackAfterWrites(toolEvents, threadId)
  ) {
    const lastPath = getWrittenPaths(toolEvents).at(-1);
    return {
      block: true,
      phase: "verify",
      statusMessage: "Reading back written files…",
      reason: "read_back_required",
      retryMessage:
        `After write_file you must read_file the changed file to confirm it saved correctly. ` +
        `Call read_file on "${lastPath}", fix any issues with write_file, then verify_project.`,
    };
  }

  const falseClaims =
    /\b(fixed|done|working|verified|successfully|all set|ready to use|should work)\b/i.test(reply) &&
    madeCodeChanges(toolEvents) &&
    !hasSuccessfulVerification(toolEvents, threadId);

  if (falseClaims) {
    const checklistBlock = buildChecklistStatusBlock(threadId, toolEvents);
    return {
      block: true,
      phase: "verify",
      statusMessage: "Claims need verification…",
      reason: "false_success_claim",
      retryMessage:
        "Do not claim the task is done or working without verification evidence. " +
        "Fix any failed checks with search_replace/write_file, then run the remaining verification checklist steps. " +
        (checklistBlock ? `\n\n${checklistBlock}` : ""),
    };
  }

  if (isProjectTask && isToolRecitationHandoff(reply)) {
    return {
      block: true,
      phase: "handoff",
      statusMessage: "Rewriting handoff summary…",
      reason: "handoff_tool_recitation",
      retryMessage: buildHandoffRecitationRetryMessage(),
    };
  }

  return { block: false };
}

export { VERIFY_PASS, VERIFY_FAIL, BASH_SUCCESS, BASH_FAILED };
