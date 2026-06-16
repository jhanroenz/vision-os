import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { upsertMemory } from "../coreMemory.js";
import { normalizeBrainProject } from "../brainProject.js";

export function createRememberTool({ threadId } = {}) {
  return tool(
    async ({ title, content, category, importance, project }) => {
      const { getActiveProjectRoot } = await import("../workspace.js");
      const scope =
        project !== undefined
          ? normalizeBrainProject(project)
          : normalizeBrainProject(threadId ? getActiveProjectRoot(threadId) : null);

      const memory = await upsertMemory({
        title,
        content,
        category: category ?? null,
        importance: importance ?? 3,
        project: scope,
        source: "agent",
        sourceConversationId: threadId ?? null,
        enabled: true,
      });

      const scopeLabel = scope ?? "global";
      return (
        `Saved core memory: "${memory.title}" (importance ${memory.importance}, project: ${scopeLabel}). ` +
        "It will persist across future conversations."
      );
    },
    {
      name: "remember",
      description:
        "Save a lasting fact, preference, project detail, issue fix, or workflow to Jarvis core memory. " +
        "Auto-tags the active project unless project is set to global. " +
        "Use importance 5 + category fix for bug/issue fixes; 4–5 for critical project notes.",
      schema: z.object({
        title: z.string().describe("Short label for the memory"),
        content: z
          .string()
          .describe("The detail to remember, in clear prose"),
        category: z
          .enum(["preference", "project", "fact", "workflow", "fix"])
          .optional()
          .describe("Memory category — use fix for issue/root-cause notes"),
        importance: z
          .number()
          .min(1)
          .max(5)
          .optional()
          .describe("1=minor (not pinned), 4=important, 5=critical fix (default 3)"),
        project: z
          .string()
          .optional()
          .describe('Project slug (e.g. portfolio) or "global" for all projects'),
      }),
    },
  );
}
