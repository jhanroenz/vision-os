import { config } from "./config.js";
import { getTaskPlan } from "./taskPlan.js";
import {
  upsertFailureMemory,
  summarizeToolArgs,
  deriveArgPatterns,
} from "./failureMemory.js";
import { normalizeBrainProject } from "./brainProject.js";

function recentToolSequence(toolEvents, limit = 6) {
  const sequence = [];
  for (const event of toolEvents ?? []) {
    if (event.type !== "tool_call") continue;
    sequence.push({
      tool: event.name,
      argsSummary: summarizeToolArgs(event.name, event.args),
    });
  }
  return sequence.slice(-limit);
}

function activePlanLabel(threadId) {
  const plan = getTaskPlan(threadId);
  const step = plan?.steps?.find((s) => s.status === "in_progress");
  if (step) return `Step ${step.id}: ${step.label}`;
  return plan?.title ?? null;
}

export function classifyToolFailure(toolName, content, args = {}) {
  const text = String(content ?? "");
  const argsSummary = summarizeToolArgs(toolName, args);

  if (/PATH REJECTED/i.test(text)) {
    const projectHint = text.match(/Active project is "([^"]+)"/i)?.[1];
    return {
      reasonClassification: "path_scope",
      actionType: "require_precondition",
      fixStrategy: "path_correction",
      precondition: "inspect_codebase",
      alternativeHint: projectHint
        ? `Use paths prefixed with ${projectHint}/`
        : "Use the active project prefix from inspect_codebase",
      applicability: {
        tools: [toolName],
        argPatterns: deriveArgPatterns(toolName, argsSummary),
      },
    };
  }

  if (/Path resolution error/i.test(text)) {
    return {
      reasonClassification: "path_scope",
      actionType: "require_precondition",
      fixStrategy: "path_correction",
      precondition: "inspect_codebase",
      alternativeHint: "Resolve paths relative to the active project root",
      applicability: {
        tools: [toolName],
        argPatterns: deriveArgPatterns(toolName, argsSummary),
      },
    };
  }

  if (toolName === "verify_project" && /STATUS: FAIL/i.test(text)) {
    return {
      reasonClassification: "verify_fail",
      actionType: "require_precondition",
      fixStrategy: "read_before_write",
      precondition: "read_file",
      alternativeHint: "Read cited error files before editing; fix and re-verify",
      applicability: { tools: ["verify_project", "write_file", "search_replace"] },
    };
  }

  if (/STATUS: FAIL/i.test(text)) {
    return {
      reasonClassification: toolName === "run_bash" ? "env_shell" : "tool_misuse",
      actionType: "caution",
      fixStrategy: "different_tool",
      alternativeHint:
        toolName === "run_bash"
          ? "Use non-interactive flags or a different command"
          : "Inspect context and adjust args before retrying",
      applicability: {
        tools: [toolName],
        argPatterns: deriveArgPatterns(toolName, argsSummary),
      },
    };
  }

  return null;
}

export function tryCaptureFailure({
  threadId,
  userMessage,
  toolName,
  toolArgs,
  toolResultContent,
  toolEvents,
  project,
}) {
  if (!config.evolution.failureCaptureEnabled) return null;

  const classification = classifyToolFailure(
    toolName,
    toolResultContent,
    toolArgs,
  );
  if (!classification) return null;

  const argsSummary = summarizeToolArgs(toolName, toolArgs);
  const activeProject = normalizeBrainProject(project);

  return upsertFailureMemory({
    project: activeProject,
    context: activeProject ? `project:${activeProject}` : "global workspace",
    goal: String(userMessage ?? "").slice(0, 400) || null,
    attemptedPlan: activePlanLabel(threadId),
    toolSequence: recentToolSequence(toolEvents),
    failurePoint: {
      tool: toolName,
      argsSummary,
    },
    reasonClassification: classification.reasonClassification,
    fixStrategy: classification.fixStrategy,
    actionType: classification.actionType,
    precondition: classification.precondition ?? null,
    alternativeHint: classification.alternativeHint ?? null,
    applicability: classification.applicability,
    source: "agent",
    sourceConversationId: threadId,
  });
}
