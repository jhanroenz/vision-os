import { HANDOFF_SUMMARY_RULES } from "./conversationPolicy.js";
import { requiresAgentTaskPlan } from "./knowledgeQA.js";
import { isCodingTask } from "./codingResearch.js";
import {
  hasSuccessfulVerification,
  hasFailedVerification,
  madeCodeChanges,
} from "./verification.js";
import {
  hasValidPlan,
  isPlanComplete,
} from "./taskPlan.js";
import { acceptanceCriteriaBlock } from "./acceptanceCriteria.js";

const handoffBriefInjected = new Map();

export function clearHandoffBriefState(threadId) {
  if (!threadId) return;
  handoffBriefInjected.delete(threadId);
}

export function handoffBriefWasInjected(threadId) {
  return threadId ? handoffBriefInjected.get(threadId) === true : false;
}

export function markHandoffBriefInjected(threadId) {
  if (!threadId) return;
  handoffBriefInjected.set(threadId, true);
}

/** Detect tool/STATUS recitation instead of outcome summary. */
export function isToolRecitationHandoff(reply) {
  const text = String(reply ?? "").trim();
  if (!text) return false;

  const mentionsToolsOrStatus =
    /\b(read_file|verify_project|inspect_ast|write_file|search_replace|check_syntax)\b/i.test(
      text,
    ) ||
    /\bSTATUS:\s*\w+/i.test(text) ||
    /\bOVERALL:\s*PASS\b/i.test(text);

  const boilerplate =
    /\b(confirmed|returned|step|preceding|tool|successfully completed the task)\b/i.test(
      text,
    );

  return mentionsToolsOrStatus && (boilerplate || text.length < 280);
}

export function isProjectHandoffTurn(userMessage) {
  const msg = String(userMessage ?? "");
  return requiresAgentTaskPlan(msg) || isCodingTask(msg);
}

/**
 * Ready when verification passed, plan done (if any), and no verify failures pending.
 */
export function isReadyForHandoff({ toolEvents, threadId, userMessage }) {
  if (!isProjectHandoffTurn(userMessage)) return false;
  if (!madeCodeChanges(toolEvents)) return false;
  if (hasFailedVerification(toolEvents)) return false;
  if (!hasSuccessfulVerification(toolEvents, threadId)) return false;
  if (hasValidPlan(threadId) && !isPlanComplete(threadId)) return false;
  return true;
}

export function shouldInjectHandoffBrief({
  toolEvents,
  threadId,
  userMessage,
  step = 0,
}) {
  if (step < 1) return false;
  if (handoffBriefWasInjected(threadId)) return false;
  return isReadyForHandoff({ toolEvents, threadId, userMessage });
}

export function buildHandoffBrief({ userMessage, threadId }) {
  const criteria = acceptanceCriteriaBlock(threadId);
  const lines = [
    "[Ready to hand off — reply in plain text to Master Jan]",
    "",
    `Original request: ${String(userMessage ?? "").trim()}`,
  ];

  if (criteria) {
    lines.push("", criteria, "", "Confirm each criterion is met in your summary (in prose, not by listing tools).");
  }

  lines.push("", HANDOFF_SUMMARY_RULES);
  lines.push(
    "",
    "Example (good): \"The template in App.vue now evaluates the expression for the display, so the calculator shows the computed result instead of raw {{ }} syntax.\"",
    "Example (bad): \"read_file confirmed the file and verify_project returned OVERALL: PASS.\"",
  );

  return lines.join("\n");
}

export function buildHandoffRecitationRetryMessage() {
  return (
    "Your handoff recites tools or STATUS lines instead of explaining the outcome.\n\n" +
    `${HANDOFF_SUMMARY_RULES}\n\n` +
    "Rewrite for Master Jan: what was wrong, what you changed, and why it works now. " +
    "Do not mention read_file, verify_project, STATUS, or OVERALL: PASS."
  );
}
