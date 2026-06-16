import { config } from "./config.js";
import { isUiTask, buildUiResearchQuery } from "./uiDesignGuidance.js";
import { isKnowledgeQuestion, requiresAgentTaskPlan, hasCodebaseLookupIntent } from "./knowledgeQA.js";
import { isPersonaOrMemoryInstruction } from "./messageIntent.js";

const PROJECT_TASK_PATTERNS = [
  /\b(implement|fix|add|refactor|scaffold|setup|install|create|build|modify|edit|update|debug|deploy)\b/i,
  /\b(boilerplate|codebase|feature|npm\s+(?:create|init|install|run))\b/i,
  /\b(todo\s*(?:list|app)?|write_file|read_file|run_bash|search_replace|mkdir)\b/i,
  /\bmakefile|cargo|composer|gradle\b/i,
  /\b(still (?:see|shows?|getting)|not working|doesn't work|does not work|broken)\b/i,
  /\b(only see|wrong page|blank page|white screen)\b/i,
];

/** Explicit tool/shell instructions — always workspace coding, any message length. */
export const EXPLICIT_TOOL_WORK =
  /\b(run_bash|write_file|read_file|search_replace|inspect_codebase|verify_project|mkdir\s+-p|use tools only|use tools)\b/i;

/** Trivial disk ops — mkdir/rmdir only, not app scaffold or feature work. */
const SIMPLE_FS_COMPLEXITY_MARKERS = [
  /\b(project|app|api|component|module|feature|scaffold|boilerplate|npm|vue|react|express|docker)\b/i,
  /\b(source|src\/|package\.json|implement|fix|debug|deploy|refactor)\b/i,
  /\bwrite_file\b/i,
  /\bsearch_replace\b/i,
];

const SIMPLE_FS_PATTERNS = [
  /\b(?:please\s+)?(?:create|make)\s+(?:a\s+)?(?:new\s+)?(?:directory|dir|folder)\b/i,
  /\b(?:create|make)\s+(?:a\s+)?(?:directory|dir|folder)\s+(?:named|called)\s+\S+/i,
  /\bmkdir(?:\s+-p)?\s+\S+/i,
  /\b(?:remove|delete)\s+(?:the\s+)?(?:directory|dir|folder)\b/i,
  /\brmdir\b/i,
];

export function isSimpleFilesystemTask(message) {
  const text = String(message ?? "").trim();
  if (!text) return false;
  if (!SIMPLE_FS_PATTERNS.some((p) => p.test(text))) return false;
  if (SIMPLE_FS_COMPLEXITY_MARKERS.some((p) => p.test(text))) return false;
  return true;
}

const WORKSPACE_CONTEXT_PATTERNS = [
  /\b(my app|my project|this project|this repo|in portfolio|in the workspace|in our app)\b/i,
  /\b(fix the|implement the|add a|scaffold a|create a)\b.{0,40}\b(app|feature|bug|page|component|api|module|route)\b/i,
];

const WEB_RESEARCH_OPT_OUT = [
  /\b(no web search|don't search|do not search|skip search|without searching|skip web)\b/i,
  /\buse tools only\b/i,
];

export const TOOLS_ALLOWED_BEFORE_RESEARCH = new Set([
  "web_search",
  "remember",
  "learn_skill",
  "recall_brain",
]);

const STACK_HINTS = [
  { pattern: /\bvue(?:\.js|3)?\b/i, label: "Vue 3" },
  { pattern: /\breact(?:\.js)?\b/i, label: "React" },
  { pattern: /\bnext\.?js\b|\bnextjs\b/i, label: "Next.js" },
  { pattern: /\bnuxt\b/i, label: "Nuxt" },
  { pattern: /\bsvelte(?:kit)?\b/i, label: "SvelteKit" },
  { pattern: /\bangular\b/i, label: "Angular" },
  { pattern: /\btypescript\b|\btsx\b|\bts\b/i, label: "TypeScript" },
  { pattern: /\bnode(?:\.js)?\b/i, label: "Node.js" },
  { pattern: /\bexpress(?:\.js)?\b/i, label: "Express.js" },
  { pattern: /\bpython\b|\bpyproject\b|\bpytest\b/i, label: "Python" },
  { pattern: /\brust\b|\bcargo\b/i, label: "Rust" },
  { pattern: /\bgo\b|\bgolang\b/i, label: "Go" },
  { pattern: /\bfastapi\b/i, label: "FastAPI" },
  { pattern: /\bdjango\b/i, label: "Django" },
  { pattern: /\btailwind\b/i, label: "Tailwind CSS" },
  { pattern: /\bvite\b/i, label: "Vite" },
  { pattern: /\bvitest\b/i, label: "Vitest" },
  { pattern: /\bplaywright\b/i, label: "Playwright" },
];

export function isCodingTask(message) {
  const text = String(message ?? "").trim();
  if (!text || isPersonaOrMemoryInstruction(text)) return false;
  if (isSimpleFilesystemTask(text)) return false;
  if (hasCodebaseLookupIntent(text)) return false;
  if (EXPLICIT_TOOL_WORK.test(text)) return true;

  const hasAction = PROJECT_TASK_PATTERNS[0].test(text);
  const hasTechTarget =
    /\b(app|api|bug|component|page|ui|file|module|route|login|auth|portfolio|npm|docker)\b/i.test(
      text,
    );

  if (WORKSPACE_CONTEXT_PATTERNS.some((p) => p.test(text)) && hasAction && hasTechTarget) {
    return true;
  }

  if (hasAction && hasTechTarget) return true;

  if (text.length <= 160 && PROJECT_TASK_PATTERNS.some((p) => p.test(text))) {
    return true;
  }

  return false;
}

export function userOptedOutOfWebResearch(message) {
  return WEB_RESEARCH_OPT_OUT.some((p) => p.test(message ?? ""));
}

const IN_PLACE_WORK_PATTERNS = [
  /\b(don't|do not)\s+create\s+(?:a\s+)?(?:new\s+)?(?:directory|folder|subdir)/i,
  /\bno new (?:dir(?:ectory)?|folder)\b/i,
  /\b(current project(?:\s+dir(?:ectory)?)?|this (?:folder|directory|project)|in place|in-place|existing (?:dir|folder|project))\b/i,
  /\bapply (?:it )?(?:on|to|in) (?:the )?(?:current|this|existing)\b/i,
];

/** User wants to extend the locked/current folder — skip mandatory web research. */
export function isInPlaceProjectWork(message, lockedRoot = null) {
  const text = String(message ?? "");
  if (!IN_PLACE_WORK_PATTERNS.some((p) => p.test(text))) return false;
  if (lockedRoot && lockedRoot !== ".") return true;
  return /\b(current|this|existing|in place|in-place)\b/i.test(text);
}

export function buildFixFollowUpBrief(message, lockedRoot) {
  const root =
    lockedRoot && lockedRoot !== "."
      ? lockedRoot
      : "the locked project folder";
  return (
    "FOLLOW-UP FIX — continue in the existing project; do NOT call web_search.\n\n" +
    `Project root: ${root}\n` +
    `Issue reported: ${summarizeTask(message)}\n\n` +
    "Check wiring first (most common when build passes but UI is wrong):\n" +
    "  • Entry file (App.vue, main.ts/js) still renders Vite/starter boilerplate\n" +
    "  • Component exists but is not imported or mounted in the parent\n" +
    "  • Router or index.html still points at the default page\n\n" +
    "Use read_file on the entry component and parent, apply write_file/search_replace, " +
    "then check_syntax and verify_project."
  );
}

function isWebSearchAttemptResult(content) {
  const text = String(content ?? "");
  if (!text || text.startsWith("Web search query cannot be empty")) return false;
  if (text.startsWith("Web search limit")) return false;
  return true;
}

export function usedWebSearch(toolEvents) {
  return toolEvents.some((e) => {
    if (e.type !== "tool_result" || e.name !== "web_search") return false;
    return isWebSearchAttemptResult(e.content);
  });
}

export function webResearchRequired(userMessage, toolEvents, context = {}) {
  if (!config.agent.requireWebResearchForCoding) return false;
  if (!requiresAgentTaskPlan(userMessage)) return false;
  if (userOptedOutOfWebResearch(userMessage)) return false;
  if (isInPlaceProjectWork(userMessage, context.lockedRoot)) return false;
  if (context.followUpProjectWork) return false;
  if (usedWebSearch(toolEvents)) return false;
  return true;
}

export function isBlockedWithoutWebResearch(toolName, userMessage, toolEvents) {
  if (!webResearchRequired(userMessage, toolEvents)) return false;
  return !TOOLS_ALLOWED_BEFORE_RESEARCH.has(toolName);
}

export function shouldForceWebResearchBeforeCoding(userMessage, reply, toolEvents) {
  return webResearchRequired(userMessage, toolEvents);
}

function detectStacks(message) {
  const found = [];
  for (const hint of STACK_HINTS) {
    if (hint.pattern.test(message)) found.push(hint.label);
  }
  return [...new Set(found)];
}

function summarizeTask(message) {
  const trimmed = String(message ?? "").trim().replace(/\s+/g, " ");
  return trimmed.length > 100 ? `${trimmed.slice(0, 97)}…` : trimmed;
}

export function buildPrimaryResearchQuery(userMessage, context = {}) {
  const queries = buildCodingResearchQueries(userMessage, context);
  return queries[0] ?? `${summarizeTask(userMessage)} best practices ${new Date().getFullYear()}`;
}

export function buildCodingResearchQueries(userMessage, { activeProject, projectType } = {}) {
  const year = new Date().getFullYear();
  const stacks = detectStacks(userMessage);
  const task = summarizeTask(userMessage);
  const stackLabel =
    stacks.length > 0
      ? stacks.join(" ")
      : projectType
        ? `${projectType} project`
        : "software project";

  if (isKnowledgeQuestion(userMessage)) {
    return [`${task} ${year}`.trim()];
  }

  const queries = [
    isUiTask(userMessage)
      ? buildUiResearchQuery(userMessage, { stackLabel, year })
      : `${stackLabel} best practices project structure ${year}`,
    `${stackLabel} latest official documentation breaking changes ${year}`,
  ];

  if (/\b(scaffold|create|new|init|boilerplate|setup)\b/i.test(userMessage)) {
    queries.push(`${stackLabel} create project CLI command ${year}`);
  }
  if (/\b(fix|bug|error|broken|debug)\b/i.test(userMessage)) {
    queries.push(`${stackLabel} ${task.slice(0, 60)} fix ${year}`);
  }
  if (activeProject && activeProject !== ".") {
    queries.push(`${stackLabel} ${activeProject} conventions ${year}`);
  }

  return [...new Set(queries)].slice(0, 1);
}

export function buildWebSearchEncouragementBrief(userMessage, context = {}) {
  if (userOptedOutOfWebResearch(userMessage)) return "";
  const query = buildPrimaryResearchQuery(userMessage, context);
  return (
    "WEB SEARCH (optional) — your training data may be outdated for library versions, APIs, and current best practices.\n\n" +
    "Consider one web_search before implementing when the task depends on up-to-date docs or conventions. " +
    "You are NOT blocked from other tools if you skip search.\n\n" +
    `Suggested query if you search: "${query}"`
  );
}

export function buildWebSearchTrainingFallbackBrief() {
  return (
    "WEB SEARCH — NO USEFUL FRESH RESULTS (your one attempt this turn is used).\n\n" +
    "Do NOT call web_search again. Proceed using your built-in training knowledge for stack conventions and implementation.\n\n" +
    "Next steps:\n" +
    "  1. Phase 1 AWARENESS — inspect_codebase / list_directory on the project root\n" +
    "  2. Phase 2 PLAN — update_task_plan\n" +
    "  3. Phase 3 EXECUTE — run_bash, write_file, verify_project"
  );
}

export function buildWebSearchRepeatBlockedMessage() {
  return (
    "Blocked web_search: exactly ONE web search is allowed per coding turn.\n\n" +
    "Use the results from your earlier search, or proceed with your built-in training knowledge.\n" +
    "Do NOT search again — continue with inspect_codebase, update_task_plan, and execute tools."
  );
}

export function buildWebResearchRetryMessage(userMessage, context = {}) {
  const query = buildPrimaryResearchQuery(userMessage, context);
  const uiNote = isUiTask(userMessage)
    ? "\nUI task: search must cover design tokens, layout pattern, and stack styling — then define tokens.css BEFORE components.\n"
    : "";
  return (
    "STOP — Phase 0 RESEARCH required.\n\n" +
    "Execution order (server blocks out-of-order tools):\n" +
    "  1. web_search — exactly ONCE this turn (then awareness → plan → execute)\n" +
    "  2. If search returns nothing useful, use your training knowledge and continue\n" +
    "  3. update_task_plan — numbered checklist (≥2 steps, last = verify)\n" +
    "  4. Execute plan steps — run_bash, write_file, read_file, verify_project\n\n" +
    uiNote +
    `Call web_search now with ONE query: "${query}"\n\n` +
    "Do NOT call update_task_plan, run_bash, or file tools until web_search completes (success or empty)."
  );
}

export function buildWebResearchBlockMessage(toolName) {
  return (
    `Blocked ${toolName}: web_search is required first on coding tasks. ` +
    "Your local LLM training is stale — search for current conventions before using this tool."
  );
}
