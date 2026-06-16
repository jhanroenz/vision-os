import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { config } from "../config.js";
import { resolveSafePath } from "../workspace.js";

function fileReadByteLimitMessage(filePath, byteLen) {
  return (
    `File too large: ${filePath} (${byteLen} bytes, max ${config.fileRead.maxBytes}).\n` +
    `Use read_file with offset/limit to read a section.`
  );
}

export const readFileTool = tool(
  async ({ path: filePath, offset = 0, limit = 0 }) => {
    const fullPath = resolveSafePath(filePath);
    let content;
    try {
      content = await fs.readFile(fullPath, "utf-8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return (
          `File not found: ${filePath}\n` +
          `The path does not exist on disk yet. ` +
          `Use write_file to create it (parent directories are created automatically), ` +
          `or list_directory to check the folder structure.`
        );
      }
      throw error;
    }
    const byteLen = Buffer.byteLength(content, "utf-8");
    if (config.fileRead.maxBytes > 0 && byteLen > config.fileRead.maxBytes) {
      return fileReadByteLimitMessage(filePath, byteLen);
    }
    const lines = content.split("\n");

    const start = Math.max(0, offset);
    const end = limit > 0 ? start + limit : lines.length;
    const slice = lines.slice(start, end);

    const numbered = slice
      .map((line, i) => `${String(start + i + 1).padStart(6)}|${line}`)
      .join("\n");

    const header =
      lines.length > end
        ? `--- ${filePath} (lines ${start + 1}-${end} of ${lines.length}) ---\n`
        : `--- ${filePath} (${lines.length} lines) ---\n`;

    return header + numbered;
  },
  {
    name: "read_file",
    description:
      "Read exact source lines (numbered). Secondary to inspect_ast — use only when AST output is insufficient " +
      "or you need precise text before search_replace. Do NOT re-fetch a file you already understood from inspect_ast this turn. " +
      "Returns the full file by default; use offset/limit on very large files.",
    schema: z.object({
      path: z.string().describe("Relative path within the workspace"),
      offset: z
        .number()
        .optional()
        .describe("0-based line offset (default 0)"),
      limit: z
        .number()
        .optional()
        .describe("Max lines to read (default 0 = all lines)"),
    }),
  },
);

export const writeFileTool = tool(
  async ({ path: filePath, content }) => {
    const fullPath = resolveSafePath(filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    let before = null;
    let action = "created";

    try {
      before = await fs.readFile(fullPath, "utf-8");
      action = "modified";
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    await fs.writeFile(fullPath, content, "utf-8");
    return {
      path: filePath,
      bytes: content.length,
      before,
      after: content,
      action,
    };
  },
  {
    name: "write_file",
    description:
      "Create or overwrite a file in the workspace. Parent directories are created automatically. " +
      "If STATUS: SKIP (already exists), use search_replace to edit or mark_plan_step done — do not retry write_file.",
    schema: z.object({
      path: z.string().describe("Relative path within the workspace"),
      content: z.string().describe("Full file content to write"),
    }),
  },
);

export const listDirectoryTool = tool(
  async ({ path: dirPath = "." }) => {
    const fullPath = resolveSafePath(dirPath);
    let entries;
    try {
      entries = await fs.readdir(fullPath, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        return (
          `Directory not found: ${dirPath}\n` +
          `Create it first: run_bash { "command": "mkdir -p ${dirPath}" }`
        );
      }
      throw error;
    }

    const lines = await Promise.all(
      entries.map(async (entry) => {
        const type = entry.isDirectory() ? "dir" : "file";
        let size = "";
        if (entry.isFile()) {
          const stat = await fs.stat(path.join(fullPath, entry.name));
          size = ` (${stat.size} bytes)`;
        }
        return `${type.padEnd(4)} ${entry.name}${size}`;
      }),
    );

    return lines.sort().join("\n") || "(empty directory)";
  },
  {
    name: "list_directory",
    description: "List files and directories in a workspace path.",
    schema: z.object({
      path: z
        .string()
        .optional()
        .describe("Relative directory path (default: workspace root)"),
    }),
  },
);
