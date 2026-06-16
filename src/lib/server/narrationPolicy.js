import { isCodingTask } from "./codingResearch.js";
import { getExecutionPhase } from "./executionOrder.js";
import { hasValidPlan } from "./taskPlan.js";

/** Prompt block — keep tool-loop responses to bare tool JSON or one-line status. */
export const EXECUTION_NARRATION_RULES = `Execution output (STRICT — your context window is limited):
- During Phases 1–3 (research, plan, execute): respond with ONLY a raw tool JSON object. No markdown, no preamble, no commentary.
- Do NOT narrate plans, explain reasoning, or describe next steps in plain text — call the tool immediately.
- Never output paragraphs between tool calls. Master Jan sees tool activity in the UI.
- Plain text is allowed ONLY on final handoff after verification passes — outcome summary for Master Jan (what changed and why), never a recap of tools or STATUS lines.
- If plain text is unavoidable between tools: ONE short line only, e.g. "Creating index.html", "Installing dependencies", "Running verify" — then call the tool in the same or next response without further prose.`;

/**
 * Hide streamed assistant prose during coding task tool loops —
 * narration belongs in tool results / activity log, not the chat bubble.
 */
export function shouldSuppressStreamNarration({
  minimalChat,
  threadId,
  toolEvents,
  message,
}) {
  if (minimalChat) return false;

  const events = toolEvents ?? [];
  if (events.length > 0) return true;

  if (!isCodingTask(message) && !hasValidPlan(threadId)) return false;

  const phase = getExecutionPhase(message, events, threadId);
  return phase === "execute" && hasValidPlan(threadId);
}

/**
 * After execute phase starts on coding tasks, skip streaming reasoning to the UI —
 * it flickers between tool steps. Research / Q&A turns keep reasoning visible
 * (that reasoning is the "planning next moves" beat Cursor shows).
 */
export function shouldSuppressStreamReasoning({
  minimalChat,
  threadId,
  toolEvents,
  message,
}) {
  if (minimalChat) return true;
  if (!isCodingTask(message) && !hasValidPlan(threadId)) return false;
  return shouldSuppressStreamNarration({
    minimalChat,
    threadId,
    toolEvents,
    message,
  });
}
