import fs from "node:fs/promises";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { resolveSafePath } from "../workspace.js";
import { inspectAst } from "../codeCheck/ast/inspect.js";

export const inspectAstTool = tool(
  async ({ path: filePath, mode, line, symbol, depth, max_nodes }) => {
    const abs = resolveSafePath(filePath);
    let content;
    try {
      content = await fs.readFile(abs, "utf-8");
    } catch {
      return `RESULT: FAILED\nFile not found: ${filePath}`;
    }

    const result = await inspectAst(filePath, content, {
      mode,
      line,
      symbol,
      depth,
      max_nodes,
    });

    if (!result.ok) {
      return `RESULT: FAILED\n${result.message}`;
    }

    return `RESULT: SUCCESS\n${result.message}`;
  },
  {
    name: "inspect_ast",
    description:
      "Tree-sitter structure — outline, subtree at a line, or symbol defs/refs. " +
      "Often sufficient to answer exports, imports, and symbol-location questions — reply from this output. " +
      "Do NOT follow with read_file if outline/subtree already answers the question. " +
      "Modes: outline (file map), subtree (AST at line), symbol (find name).",
    schema: z.object({
      path: z.string().describe("Workspace-relative file path"),
      mode: z
        .enum(["outline", "subtree", "symbol"])
        .optional()
        .describe("outline | subtree | symbol (default: outline)"),
      line: z
        .number()
        .optional()
        .describe("1-based line for mode=subtree"),
      symbol: z
        .string()
        .optional()
        .describe("Identifier name for mode=symbol"),
      depth: z
        .number()
        .optional()
        .describe("Max AST depth for subtree (default from server config)"),
      max_nodes: z
        .number()
        .optional()
        .describe("Max nodes in output (default from server config)"),
    }),
  },
);
