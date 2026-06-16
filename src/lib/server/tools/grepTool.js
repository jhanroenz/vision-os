import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { resolveSafePath } from "../workspace.js";

const execFileAsync = promisify(execFile);

async function tryRipgrep(workDir, pattern, { glob, caseInsensitive, maxResults }) {
  const args = [
    "--line-number",
    "--no-heading",
    "--max-count",
    String(maxResults),
    "--",
    pattern,
    ".",
  ];
  if (glob) args.splice(0, 0, "--glob", glob);
  if (caseInsensitive) args.splice(0, 0, "-i");

  const { stdout } = await execFileAsync("rg", args, {
    cwd: workDir,
    maxBuffer: 1024 * 1024,
    timeout: 30000,
  });
  return stdout;
}

async function fallbackGrep(workDir, pattern, { caseInsensitive, maxResults }) {
  const args = ["-r", "-n", "-E", "--exclude-dir=node_modules", "--exclude-dir=.git"];
  if (caseInsensitive) args.push("-i");
  args.push(pattern, ".");

  const { stdout } = await execFileAsync("grep", args, {
    cwd: workDir,
    maxBuffer: 1024 * 1024,
    timeout: 30000,
  });
  return stdout.split("\n").slice(0, maxResults).join("\n");
}

export const grepCodeTool = tool(
  async ({
    pattern,
    path: searchPath = ".",
    glob = "",
    case_insensitive = false,
    max_results = 40,
  }) => {
    if (!pattern?.trim()) return "Error: pattern is required";

    const workDir = resolveSafePath(searchPath);
    const relCwd =
      path.relative(resolveSafePath("."), workDir).replace(/\\/g, "/") || ".";
    const maxResults = Math.min(Math.max(max_results, 1), 100);

    let output = "";
    try {
      output = await tryRipgrep(workDir, pattern, {
        glob: glob || undefined,
        caseInsensitive: case_insensitive,
        maxResults,
      });
    } catch (rgError) {
      if (rgError.code === "ENOENT") {
        try {
          output = await fallbackGrep(workDir, pattern, {
            caseInsensitive: case_insensitive,
            maxResults,
          });
        } catch (grepError) {
          return (
            `Search failed in ${relCwd}.\n` +
            `Install ripgrep (rg) or ensure grep is available.\n` +
            `${grepError.message}`
          );
        }
      } else if (rgError.code === 1) {
        return `No matches for /${pattern}/ in ${relCwd}`;
      } else {
        return `grep_code error: ${rgError.message}`;
      }
    }

    const lines = output.trim().split("\n").filter(Boolean);
    if (!lines.length) return `No matches for /${pattern}/ in ${relCwd}`;

    const truncated = lines.length > maxResults;
    const body = lines.slice(0, maxResults).join("\n");
    return [
      `=== GREP: /${pattern}/ in ${relCwd} ===`,
      `Matches: ${lines.length}${truncated ? ` (showing ${maxResults})` : ""}`,
      "",
      body,
    ].join("\n");
  },
  {
    name: "grep_code",
    description:
      "Search the codebase for a regex pattern (ripgrep/grep). Use to find symbols, imports, usages, and conventions before editing.",
    schema: z.object({
      pattern: z.string().describe("Regex pattern to search for"),
      path: z
        .string()
        .optional()
        .describe("Directory to search relative to workspace (default: agent cwd)"),
      glob: z
        .string()
        .optional()
        .describe('Optional file glob filter, e.g. "*.vue" or "*.ts"'),
      case_insensitive: z.boolean().optional().describe("Case insensitive search"),
      max_results: z.number().optional().describe("Max matches (default 40, max 100)"),
    }),
  },
);
