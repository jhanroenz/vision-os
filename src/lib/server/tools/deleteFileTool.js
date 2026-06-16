import fs from "node:fs/promises";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { resolveSafePath } from "../workspace.js";

const BLOCKED_PATTERNS = [
  /^\.?$/,
  /^\.git(?:\/|$)/,
  /^\.jarvis(?:\/|$)/,
  /\/\.git(?:\/|$)/,
  /\/\.jarvis(?:\/|$)/,
  /node_modules(?:\/|$)/,
];

export function isBlockedDelete(relativePath) {
  const normalized = String(relativePath ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
  return BLOCKED_PATTERNS.some((p) => p.test(normalized));
}

export const deleteFileTool = tool(
  async ({ path: filePath }) => {
    if (isBlockedDelete(filePath)) {
      return (
        "RESULT: FAILED (exit 1)\n" +
        `Blocked: cannot delete protected path "${filePath}".`
      );
    }

    const fullPath = resolveSafePath(filePath);
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        return `RESULT: FAILED (exit 1)\nFile not found: ${filePath}`;
      }
      throw error;
    }

    if (stat.isDirectory()) {
      return (
        "RESULT: FAILED (exit 1)\n" +
        `${filePath} is a directory — delete_file only removes files. ` +
        `Use run_bash with rm -r for empty directories if needed.`
      );
    }

    await fs.unlink(fullPath);
    return `RESULT: SUCCESS (exit 0)\nDeleted ${filePath} (${stat.size} bytes)`;
  },
  {
    name: "delete_file",
    description:
      "Delete a file from the workspace. Use to remove wrong scaffolds or stray files. " +
      "Cannot delete .git, .jarvis, or node_modules paths.",
    schema: z.object({
      path: z.string().describe("Workspace-relative file path to delete"),
    }),
  },
);
