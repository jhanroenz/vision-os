import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { recallBrain, formatRecallBrainResult } from "../brainRecall.js";
import { normalizeBrainProject } from "../brainProject.js";

export function createRecallBrainTool(ctx = {}) {
  const threadId = ctx.threadId ?? "default";

  return tool(
    async ({ query, type, limit, project }) => {
      const { getActiveProjectRoot } = await import("../workspace.js");
      const scope =
        project !== undefined
          ? normalizeBrainProject(project)
          : normalizeBrainProject(getActiveProjectRoot(threadId));
      const result = await recallBrain({ query, type, limit, project: scope });
      return formatRecallBrainResult(result);
    },
    {
      name: "recall_brain",
      description:
        "Search Jarvis core memory and learned skills on demand (keyword + semantic hybrid). " +
        "Scoped to the active project plus global items by default. " +
        "Use when a task may depend on past fixes, project facts, preferences, or workflows " +
        "that are not in the pinned brain index.",
      schema: z.object({
        query: z
          .string()
          .describe(
            "What to look up — e.g. 'portfolio path prefix', 'Master Jan preferences', 'vite scaffold'",
          ),
        type: z
          .enum(["memory", "skill", "both"])
          .optional()
          .describe("Search memories, skills, or both (default both)"),
        limit: z
          .number()
          .min(1)
          .max(12)
          .optional()
          .describe("Max results (default from server config)"),
        project: z
          .string()
          .optional()
          .describe(
            "Project scope slug (e.g. portfolio) or global. Defaults to active project.",
          ),
      }),
    },
  );
}
