import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { upsertSkill } from "../skills.js";
import { normalizeBrainProject } from "../brainProject.js";

export function createLearnSkillTool({ threadId } = {}) {
  return tool(
    async ({ name, description, instructions, project }) => {
      const { getActiveProjectRoot } = await import("../workspace.js");
      const scope =
        project !== undefined
          ? normalizeBrainProject(project)
          : normalizeBrainProject(threadId ? getActiveProjectRoot(threadId) : null);

      const skill = await upsertSkill({
        name,
        description,
        instructions,
        project: scope,
        source: "agent",
        sourceConversationId: threadId ?? null,
        enabled: true,
      });

      const scopeLabel = scope ?? "global";
      return (
        `Learned skill: "${skill.name}" (project: ${scopeLabel}). ` +
        "Jarvis will apply this approach in future tasks for this scope."
      );
    },
    {
      name: "learn_skill",
      description:
        "Save a reusable skill or workflow pattern Jarvis should follow in future tasks. " +
        "Auto-tags the active project unless project is global.",
      schema: z.object({
        name: z.string().describe("Short skill name"),
        description: z
          .string()
          .describe("One-line summary of what this skill does"),
        instructions: z
          .string()
          .describe("Actionable steps or rules Jarvis should follow when this skill applies"),
        project: z
          .string()
          .optional()
          .describe('Project slug (e.g. portfolio) or "global" for all projects'),
      }),
    },
  );
}
