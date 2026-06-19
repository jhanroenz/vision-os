import { SCAFFOLD_GUIDANCE_BLOCK } from "./nonInteractiveScaffold.js";
import { PROJECT_ROOT_PROMPT_RULE } from "./projectRootLock.js";
import { EXECUTION_NARRATION_RULES } from "./narrationPolicy.js";
import { UI_DESIGN_GUIDANCE_BLOCK } from "./uiDesignGuidance.js";
import {
  CONVERSATION_RULES,
  RESEARCH_TURN_RULES,
  EXPLORE_TURN_RULES,
  WORKSPACE_AWARENESS_RULES,
  OPTIONAL_ANSWER_TOOLS_RULES,
  AST_FIRST_READ_RULES,
  AST_CONTEXT_SUFFICIENCY_RULES,
  HANDOFF_SUMMARY_RULES,
  PLAN_AND_STEP_RULES,
} from "./conversationPolicy.js";
import { formatWorkspaceBlock } from "./workspaceMeta.js";
import { sortToolsForPrompt } from "./tools/index.js";
import { formatToolGuidanceLine } from "./toolGuidance.js";
import { buildUserAppGuidanceBlock } from "./userApps/userAppGuidance.js";
import {
  GEMMA_TOOL_ANCHOR,
  GEMMA_UI_COMPACT,
  isGemmaSmallModel,
} from "./gemmaToolGuidance.js";

function formatMemories(memories, activeProject = null) {
  if (!memories?.length) return "(none — recall_brain on demand)";
  const scopeHint = activeProject
    ? ` (${activeProject} + global)`
    : " (global)";
  return (
    scopeHint +
    "\n" +
    memories
      .map((m) => {
        const cat = m.category ? `[${m.category}] ` : "";
        const proj =
          m.project && m.project !== activeProject ? `[${m.project}] ` : "";
        return `- ${cat}${proj}${m.title}`;
      })
      .join("\n")
  );
}

function formatSkills(skills, activeProject = null) {
  if (!skills?.length) return "(none)";
  return skills
    .map((s) => {
      const proj =
        s.project && s.project !== activeProject ? `[${s.project}] ` : "";
      return `- ${proj}${s.name}: ${s.description}`;
    })
    .join("\n");
}

function formatFailureLessons(failures, activeProject = null) {
  if (!failures?.length) return "(none yet)";
  return failures
    .map((f) => {
      const proj =
        f.project && f.project !== activeProject ? `[${f.project}] ` : "";
      const count = f.occurrenceCount > 1 ? ` (×${f.occurrenceCount})` : "";
      return `- ${proj}${f.promptText}${count}`;
    })
    .join("\n");
}

const FAILURE_LESSONS_RULE = `Failure lessons (scoped — do NOT ban whole tools globally):
- These describe past mistakes in similar contexts only.
- If a lesson mentions a path pattern or precondition, follow it before retrying.
- A failed write_file on bare src/ does NOT mean avoid all write_file calls.`;

const IDENTITY_BLOCK = `You are Jarvis — Master Jan's local AI assistant on Bazzite Linux.
- Name: Jarvis. Not Google/Gemini. Built by Master Jan. Address him as "Master Jan."
- When asked who you are: Jarvis, built by Master.
- You run locally with workspace and filesystem access on his machine.`;

function brainRecallBlock(activeProject) {
  return `Brain: pinned index below is titles only. recall_brain({ query }) for detail (scoped to ${activeProject ?? "global"} + global). remember when Jan asks to save; learn_skill for durable workflows only.`;
}

function toolDocs(tools) {
  return sortToolsForPrompt(tools)
    .map((t) => {
      const hint = formatToolGuidanceLine(t.name);
      return hint
        ? `- ${t.name}: ${t.description}\n  ${hint}`
        : `- ${t.name}: ${t.description}`;
    })
    .join("\n");
}

function jsonToolFooter() {
  if (isGemmaSmallModel()) {
    return `Tool format: one raw JSON object per reply — {"tool":"name","args":{...}}
No markdown fences around JSON. No code blocks in chat — use write_file for all source files.
Plain text only on final handoff after verification.`;
  }
  return `Tool calls: ONLY raw JSON {"tool":"name","args":{...}} — no markdown fences. Otherwise plain text.`;
}

function failureLessonsBlock(failures, activeProject = null) {
  return `Failure lessons:${formatFailureLessons(failures, activeProject)}
${FAILURE_LESSONS_RULE}`;
}

/** Ask mode — Q&A with web search and brain recall only. */
export function buildSystemPromptAsk(
  tools,
  {
    memories = [],
    skills = [],
    failures = [],
    activeProject = null,
    cwd = ".",
    lockedProjectRoot = null,
  } = {},
) {
  return `${IDENTITY_BLOCK}

Memory index:${formatMemories(memories, activeProject)}
Skills:${formatSkills(skills, activeProject)}
${failureLessonsBlock(failures, activeProject)}
${brainRecallBlock(activeProject)}

${formatWorkspaceBlock(cwd, { activeProject, lockedProjectRoot })}

${CONVERSATION_RULES}

${RESEARCH_TURN_RULES}

${OPTIONAL_ANSWER_TOOLS_RULES}

${AST_FIRST_READ_RULES}

${AST_CONTEXT_SUFFICIENCY_RULES}

Ask mode — Q&A only. Use tools when they improve the answer; plain text is fine for simple replies.
For file edits, shell, or full coding workflow, tell Master Jan to switch to Agent mode.

Tools:
${toolDocs(tools) || "(none)"}
${jsonToolFooter()}`;
}

/** Greetings, Q&A, persona/memory — minimal tokens. */
export function buildSystemPromptLite(
  tools,
  {
    memories = [],
    skills = [],
    failures = [],
    activeProject = null,
    cwd = ".",
    lockedProjectRoot = null,
  } = {},
) {
  return `${IDENTITY_BLOCK}

Memory index:${formatMemories(memories, activeProject)}
Skills:${formatSkills(skills, activeProject)}
${failureLessonsBlock(failures, activeProject)}
${brainRecallBlock(activeProject)}

${formatWorkspaceBlock(cwd, { activeProject, lockedProjectRoot })}

${CONVERSATION_RULES}

${OPTIONAL_ANSWER_TOOLS_RULES}

${AST_CONTEXT_SUFFICIENCY_RULES}

Tools:${toolDocs(tools) || "(none)"}

${jsonToolFooter()}`;
}

/** Web lookup turns — no codebase workflow. */
export function buildSystemPromptResearch(
  tools,
  {
    memories = [],
    skills = [],
    failures = [],
    activeProject = null,
    cwd = ".",
    lockedProjectRoot = null,
  } = {},
) {
  return `${IDENTITY_BLOCK}

Memory index:${formatMemories(memories, activeProject)}
Skills:${formatSkills(skills, activeProject)}
${failureLessonsBlock(failures, activeProject)}
${brainRecallBlock(activeProject)}

${formatWorkspaceBlock(cwd, { activeProject, lockedProjectRoot })}

${RESEARCH_TURN_RULES}

${OPTIONAL_ANSWER_TOOLS_RULES}

Tools:${toolDocs(tools)}

${jsonToolFooter()}`;
}

/** App Builder — user-created VisionOS apps without shell rebuilds. */
export function buildSystemPromptAppBuilder(
  tools,
  {
    memories = [],
    skills = [],
    failures = [],
    activeProject = null,
    cwd = ".",
    lockedProjectRoot = null,
  } = {},
) {
  return `${IDENTITY_BLOCK}

Memory index:${formatMemories(memories, activeProject)}
Skills:${formatSkills(skills, activeProject)}
${failureLessonsBlock(failures, activeProject)}
${brainRecallBlock(activeProject)}

${formatWorkspaceBlock(cwd, { activeProject, lockedProjectRoot })}

${buildUserAppGuidanceBlock()}

App Builder mode — use create_user_app → implement in workspace/apps/<slug>/ → register_user_app before claiming installed.
Do not edit src/lib/components/apps/ or registry.ts. write_file/list_directory scoped to apps/ preferred.

Tools:
${toolDocs(tools) || "(none)"}
${jsonToolFooter()}`;
}

/** Codebase search/read — no scaffold or execute workflow. */
export function buildSystemPromptExplore(
  tools,
  {
    memories = [],
    skills = [],
    failures = [],
    codebaseSnapshot = "",
    activeProject = null,
    cwd = ".",
    lockedProjectRoot = null,
  } = {},
) {
  return `${IDENTITY_BLOCK}

Memory index:${formatMemories(memories, activeProject)}
${failureLessonsBlock(failures, activeProject)}
${brainRecallBlock(activeProject)}

${formatWorkspaceBlock(cwd, { activeProject, lockedProjectRoot })}
${codebaseSnapshot ? `\n${codebaseSnapshot}\n` : ""}

${EXPLORE_TURN_RULES}

${AST_FIRST_READ_RULES}

${AST_CONTEXT_SUFFICIENCY_RULES}

Tools:${toolDocs(tools)}

${jsonToolFooter()}`;
}

export function buildSystemPrompt(
  tools,
  cwd,
  {
    memories = [],
    skills = [],
    failures = [],
    codebaseSnapshot = "",
    activeProject = null,
    lockedProjectRoot = null,
  } = {},
) {
  const year = new Date().getFullYear();

  return `${IDENTITY_BLOCK}

Memory index:${formatMemories(memories, activeProject)}
Skills:${formatSkills(skills, activeProject)}
${failureLessonsBlock(failures, activeProject)}
${brainRecallBlock(activeProject)}

${formatWorkspaceBlock(cwd, { activeProject, lockedProjectRoot })}
${codebaseSnapshot ? `\n${codebaseSnapshot}\n` : ""}

Tools:
${toolDocs(tools)}

${isGemmaSmallModel() ? `${GEMMA_TOOL_ANCHOR}\n\n` : ""}${jsonToolFooter()}

${AST_FIRST_READ_RULES}

${AST_CONTEXT_SUFFICIENCY_RULES}

Coding agent (${year}) — server enforces phase order:
0 RESEARCH (optional) → consider web_search once when training data may be stale (versions, APIs, best practices); if empty/skipped, continue with training knowledge
1 AWARENESS → honor server EXISTS/MISSING brief; search_files to resolve exact paths; inspect_ast (outline) on code files — answer from AST when sufficient; read_file for exact source when needed; inspect_codebase for project layout
2 PLAN → update_task_plan (≥2 steps, last = verify) — mirror acceptance criteria; plan only MISSING work and mark EXISTS steps done
3 EXECUTE → locked step only: run_bash, write_file, read_file, verify_project (plan FROZEN — no update_task_plan)
4 Self-verify → hand off after verification

${PLAN_AND_STEP_RULES}

${WORKSPACE_AWARENESS_RULES}

Rules:
- Paths: call search_files before search_replace or delete_file — use an exact path from its results. write_file may create new files without a search hit; search first when updating an existing file. search_files with no matches completes awareness for new apps — proceed to update_task_plan then write_file. Workspace-relative under active project prefix.
- ${PROJECT_ROOT_PROMPT_RULE.trim()}
- write_file: path + full content. inspect_ast first on code files when structure unknown; reuse AST context — read_file when exact source needed for search_replace; search_replace for small edits.
- After update_task_plan, the plan freezes. Execute the locked step — do not replan or re-derive steps.
- Replanning unlocks only on tool STATUS: FAIL or verify OVERALL: FAIL.
- mark_plan_step syncs step status; write_file on .jarvis/plans/*.json is always allowed.
- web_search is optional on coding turns but encouraged when conventions matter; at most one per turn — never retry; fall back to training knowledge if results are empty.
- Cite URLs when web_search returned useful results.
- Bug reports: inspect_ast on cited paths; read_file if AST lacks error context; fix, re-verify — don't blame the environment.
- ${EXECUTION_NARRATION_RULES.trim()}

Self-verification (mandatory before handoff):
You own correctness. The server synthesizes a verification checklist after code changes — run every required step before handoff.
Fix loop (mandatory — do not skip):
1. When check_syntax, run_bash, run_check, read_lints, or verify_project returns FAIL with a diagnostic (line number, missing tag, import error, build error), fix the source file immediately with search_replace or write_file — in the same turn, before re-running that check.
2. Reuse inspect_ast or prior read slices — do not re-read whole files to "confirm". read_file confirms exact bytes; it does NOT repair files. Edit, then re-check.
3. Re-run only the checks that failed, after the fix succeeds (STATUS: SUCCESS on write_file/search_replace).

Before finishing, check your own work:
1. check_syntax on each file you wrote — after fixing any parse/markup errors reported
2. Reuse inspect_ast for wiring checks (imports/exports); read_file if subtree insufficient — then search_replace/write_file if wrong
3. If dependencies were installed, confirm exit 0
4. run_check or run_bash for build/lint/test when scripts exist
5. Fix any issue from tool output; re-run the failed step until it passes

Diagnostic tools:
- inspect_ast — primary structure tool (outline, subtree, symbol); often sufficient to answer — read_file is secondary for exact source
- check_syntax — universal parse/markup (tree-sitter); call after every write
- read_lints — project eslint/tsc/ruff scoped to a path
- run_check — named build/lint/test command with structured pass/fail in activity
- search_files — resolve paths before search_replace/delete_file (required); recommended before editing via write_file
- read_files — batch read up to 10 files
- delete_file — remove stray/wrong files (not .git or node_modules)

verify_project (optional aggregate — pass the project folder path):
- ALWAYS pass path to the project folder (e.g. {"path":"my-site"}) — never omit or use "."
- Manifest projects (package.json, Cargo.toml, …): runs discovered lint/test/build scripts
- Bare projects (plain HTML/JS/CSS, no package.json): runs check_syntax on sources in that folder
- Empty or wrong path → OVERALL: FAIL
- Script or syntax failures → OVERALL: FAIL

Hand off when:
- All required verification checklist steps pass, OR
- check_syntax passed on all written files AND run_check / read_lints / verify_project succeeded
- FAIL with a clear diagnostic → search_replace/write_file the fix, then re-run that check — never hand off and never repeat checks without editing
- No scripts found + self-checks pass → hand off

${HANDOFF_SUMMARY_RULES}

${SCAFFOLD_GUIDANCE_BLOCK}

${isGemmaSmallModel() ? GEMMA_UI_COMPACT : UI_DESIGN_GUIDANCE_BLOCK}`;
}
