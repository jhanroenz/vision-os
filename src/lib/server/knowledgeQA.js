import { isCodingTask } from "./codingResearch.js";
import { isUiTask } from "./uiDesignGuidance.js";

/** Conceptual / educational questions — not workspace implementation work. */
const KNOWLEDGE_QA_PATTERNS = [
  /\b(what is|what are|how does|how do|explain|tell me about|describe)\b/i,
  /\b(compare|comparison|difference between|vs\.?|versus)\b/i,
  /\b(any other|what about|how about|another|other)\b/i,
  /\b(sorting algorithm|search algorithm|data structure|big\s*o|time complexity|space complexity)\b/i,
  /\b(bubble sort|merge sort|quick\s*sort|heap sort|insertion sort|selection sort|radix sort)\b/i,
  /\b(best way to|how to)\b.{0,40}\b(in javascript|in python|in java|in rust|in c\+\+)\b/i,
  /\b(search|look up|find)\b.{0,30}\b(best way|how to|examples?)\b/i,
  /\b(algorithm|complexity|leetcode|interview)\b/i,
];

const WORKSPACE_WORK_MARKERS = [
  /\b(my app|my project|this project|this repo|the codebase|in our app|in the workspace)\b/i,
  /\b(write_file|read_file|inspect_codebase|verify_project)\b/i,
  /\b(implement|scaffold|refactor|deploy|fix the bug|in portfolio\/)\b/i,
];

const CODEBASE_EXPLORATORY_PATTERNS = [
  /\b(where is .+ (?:defined|implemented|handled))\b/i,
  /\b(where|which file|which module|what file|locate|look up|look for)\b.{0,80}\b(in (?:my|the|this) (?:app|project|repo|codebase)|codebase|repo|repository)\b/i,
  /\b(in (?:my|the|this) (?:app|project|repo|codebase)|the codebase|this codebase|this project)\b.{0,80}\b(where|which|what|find|grep|search|locate|handled|defined|implemented)\b/i,
  /\b(grep|glob_files|semantic_search|inspect_codebase|inspect_ast)\b/i,
  /\bfind (?:the )?(?:file|function|handler|class|module|component|route|symbol)\b/i,
  /\bsearch (?:the )?(?:codebase|repo|repository)\b/i,
  /\btrace\b.{0,60}\b(function|method|symbol|defined|calls?)\b/i,
];

const IMPLEMENTATION_VERBS =
  /\b(fix|implement|add|refactor|scaffold|create|build|deploy|debug|install|setup|modify|update|write)\b/i;

export function hasCodebaseLookupIntent(message) {
  const text = String(message ?? "").trim();
  if (!text) return false;
  if (IMPLEMENTATION_VERBS.test(text)) return false;
  return CODEBASE_EXPLORATORY_PATTERNS.some((p) => p.test(text));
}

/** Codebase read/locate turns — optional task plan, no mandatory coding workflow. */
export function allowsOptionalTaskPlan(message) {
  return hasCodebaseLookupIntent(message);
}

export function isKnowledgeQuestion(message) {
  const text = String(message ?? "").trim();
  if (!text) return false;
  if (isCodingTask(text) || isUiTask(text)) return false;
  if (hasCodebaseLookupIntent(text)) return false;
  if (WORKSPACE_WORK_MARKERS.some((p) => p.test(text))) return false;
  return KNOWLEDGE_QA_PATTERNS.some((p) => p.test(text));
}

/** Multi-step task plan + execute gates apply only to real workspace coding/UI work. */
export function requiresAgentTaskPlan(message) {
  const text = String(message ?? "").trim();
  if (!text) return false;
  if (allowsOptionalTaskPlan(text)) return false;
  if (isKnowledgeQuestion(text)) return false;
  return isCodingTask(text) || isUiTask(text);
}

export function isProjectTaskMessage(message) {
  return requiresAgentTaskPlan(message);
}

/** Keep an active/persisted task plan only for real coding work or follow-up fixes. */
export function shouldRetainTaskPlanForTurn(message, turnIntent = {}) {
  if (turnIntent.followUpProjectWork) return true;
  return requiresAgentTaskPlan(message);
}
