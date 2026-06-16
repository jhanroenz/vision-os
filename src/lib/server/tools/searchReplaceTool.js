import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { resolveSafePath } from "../workspace.js";

export const searchReplaceTool = tool(
  async ({ path: filePath, old_string, new_string, replace_all = false }) => {
    const fullPath = resolveSafePath(filePath);
    let before;
    try {
      before = await fs.readFile(fullPath, "utf-8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return `Error: file not found: ${filePath}`;
      }
      throw error;
    }

    if (!old_string) {
      return "Error: old_string is required";
    }

    if (!before.includes(old_string)) {
      return (
        `Error: old_string not found in ${filePath}.\n` +
        "Call read_file first and copy the exact text to replace (including whitespace)."
      );
    }

    const occurrences = before.split(old_string).length - 1;
    if (!replace_all && occurrences > 1) {
      return (
        `Error: old_string appears ${occurrences} times in ${filePath}.\n` +
        "Provide more context in old_string to make it unique, or set replace_all: true."
      );
    }

    const after = replace_all
      ? before.split(old_string).join(new_string)
      : before.replace(old_string, new_string);

    await fs.writeFile(fullPath, after, "utf-8");

    const replaced = replace_all ? occurrences : 1;
    return {
      path: filePath,
      bytes: after.length,
      before,
      after,
      action: "modified",
      replacements: replaced,
    };
  },
  {
    name: "search_replace",
    description:
      "Apply a surgical edit: replace old_string with new_string in an existing file. " +
      "Prefer this over write_file for small changes. old_string must match exactly once unless replace_all is true.",
    schema: z.object({
      path: z.string().describe("Relative path within the workspace"),
      old_string: z.string().describe("Exact text to find (must be unique unless replace_all)"),
      new_string: z.string().describe("Replacement text"),
      replace_all: z
        .boolean()
        .optional()
        .describe("Replace every occurrence (default false)"),
    }),
  },
);
