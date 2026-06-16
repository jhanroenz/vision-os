import fs from "node:fs/promises";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { config } from "../config.js";
import { resolveSafePath } from "../workspace.js";

const MAX_FILES = 10;
const DEFAULT_LIMIT = 0;

function formatFileContent(filePath, content, limit = DEFAULT_LIMIT) {
  const lines = content.split("\n");
  const end = limit > 0 ? Math.min(lines.length, limit) : lines.length;
  const slice = lines.slice(0, end);
  const numbered = slice
    .map((line, i) => `${String(i + 1).padStart(6)}|${line}`)
    .join("\n");

  const header =
    lines.length > end
      ? `--- ${filePath} (lines 1-${end} of ${lines.length}) ---\n`
      : `--- ${filePath} (${lines.length} lines) ---\n`;

  return header + numbered;
}

export const readFilesTool = tool(
  async ({ paths, limit = DEFAULT_LIMIT }) => {
    const list = (Array.isArray(paths) ? paths : [paths]).map(String).filter(Boolean);
    if (!list.length) {
      return "RESULT: FAILED (exit 1)\nNo paths provided.";
    }
    if (list.length > MAX_FILES) {
      return (
        `RESULT: FAILED (exit 1)\n` +
        `Too many paths (${list.length}). Maximum is ${MAX_FILES} per call.`
      );
    }

    const sections = [];
    let missing = 0;

    for (const filePath of list) {
      const fullPath = resolveSafePath(filePath);
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        const byteLen = Buffer.byteLength(content, "utf-8");
        if (config.fileRead.maxBytes > 0 && byteLen > config.fileRead.maxBytes) {
          sections.push(
            `--- ${filePath} ---\n` +
              `File too large (${byteLen} bytes, max ${config.fileRead.maxBytes}). ` +
              `Use read_file with offset/limit.`,
          );
        } else {
          sections.push(formatFileContent(filePath, content, limit));
        }
      } catch (error) {
        missing++;
        if (error.code === "ENOENT") {
          sections.push(`--- ${filePath} ---\nFile not found`);
        } else {
          sections.push(`--- ${filePath} ---\nError: ${error.message}`);
        }
      }
    }

    const status = missing === list.length ? "FAILED (exit 1)" : "SUCCESS (exit 0)";
    return `RESULT: ${status}\nRead ${list.length - missing}/${list.length} file(s)\n\n${sections.join("\n\n")}`;
  },
  {
    name: "read_files",
    description:
      "Batch read multiple files (numbered lines). " +
      `Up to ${MAX_FILES} paths. Prefer inspect_ast per file for structure Q&A — batch read only when exact source is needed for edits. ` +
      "Do not batch-read files already covered by inspect_ast this turn.",
    schema: z.object({
      paths: z
        .array(z.string())
        .describe("Workspace-relative file paths to read"),
      limit: z
        .number()
        .optional()
        .describe(`Max lines per file (default 0 = all lines)`),
    }),
  },
);
