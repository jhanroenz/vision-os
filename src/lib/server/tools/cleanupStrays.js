import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  findWorkspaceStrays,
  removeWorkspaceStrays,
  formatStrayReport,
} from "../workspaceStrays.js";
import { getActiveProjectRoot } from "../workspace.js";

export function createCleanupStrayPathsTool(ctx = {}) {
  const threadId = ctx.threadId ?? "default";

  return tool(
    async ({ paths }) => {
      const project = getActiveProjectRoot(threadId);

      if (!project || project === ".") {
        return "No active project set. Call inspect_codebase first.";
      }

      const before = await findWorkspaceStrays(project);
      if (!before.length) {
        return "No workspace stray paths detected — nothing to clean up.";
      }

      const toRemove = paths?.length ? paths : before.map((s) => s.path);
      const { removed, skipped, remaining } = await removeWorkspaceStrays(
        project,
        toRemove,
      );

      const lines = [
        `Removed: ${removed.length ? removed.join(", ") : "(none)"}`,
      ];
      if (skipped.length) lines.push(`Skipped: ${skipped.join("; ")}`);
      if (remaining.length) {
        lines.push("");
        lines.push(formatStrayReport(remaining, project));
      } else {
        lines.push(
          "All detected stray paths cleared. Call verify_project again.",
        );
      }
      return lines.join("\n");
    },
    {
      name: "cleanup_stray_paths",
      description:
        "Remove mistaken folders/files at workspace root (e.g. stray src/ outside the active project). " +
        "Only deletes paths flagged as strays — safe after scaffold mistakes.",
      schema: z.object({
        paths: z
          .array(z.string())
          .optional()
          .describe("Stray paths to remove (default: all detected strays)"),
      }),
    },
  );
}
