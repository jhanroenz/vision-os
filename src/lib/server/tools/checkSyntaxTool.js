import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from "node:fs/promises";
import { resolveSafePath } from "../workspace.js";
import { checkSyntaxWithTreeSitter } from "../codeCheck/treeSitter.js";

function formatResult(filePath, grammar, errors) {
  const lines = [`check_syntax: ${filePath}`];
  if (grammar) lines.push(`Language: ${grammar}`);

  if (!errors.length) {
    lines.push("RESULT: SUCCESS (exit 0)", "No syntax or markup errors detected.");
    return lines.join("\n");
  }

  lines.push(`RESULT: FAILED (exit 1)`, `${errors.length} issue(s):`);
  for (const err of errors.slice(0, 15)) {
    const col = err.column ? `:${err.column}` : "";
    lines.push(`  line ${err.line}${col}: ${err.message}`);
  }
  if (errors.length > 15) {
    lines.push(`  … and ${errors.length - 15} more`);
  }
  return lines.join("\n");
}

export const checkSyntaxTool = tool(
  async ({ path: filePath }) => {
    const abs = resolveSafePath(filePath);
    let content;
    try {
      content = await fs.readFile(abs, "utf-8");
    } catch {
      return `RESULT: FAILED (exit 1)\nFile not found: ${filePath}`;
    }

    const { grammar, errors } = await checkSyntaxWithTreeSitter(filePath, content);
    return formatResult(filePath, grammar, errors);
  },
  {
    name: "check_syntax",
    description:
      "Parse a source file with tree-sitter to detect syntax errors and Vue/HTML markup issues " +
      "(missing </template>, </style>, etc.). Call after write_file on code files before verify/build.",
    schema: z.object({
      path: z.string().describe("Workspace-relative file path to check"),
    }),
  },
);
