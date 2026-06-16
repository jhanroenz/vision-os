import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { resolveSafePath } from "../workspace.js";

function globToRegex(globPattern) {
  const escaped = globPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = escaped
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`);
}

async function walkGlob(rootAbs, rootRel, pattern, maxResults, results = []) {
  if (results.length >= maxResults) return results;

  let entries;
  try {
    entries = await fs.readdir(rootAbs, { withFileTypes: true });
  } catch {
    return results;
  }

  const matcher = globToRegex(pattern);

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (results.length >= maxResults) break;
    if (entry.name === "node_modules" || entry.name === ".git") continue;

    const rel = rootRel === "." ? entry.name : `${rootRel}/${entry.name}`;
    const full = path.join(rootAbs, entry.name);

    if (entry.isDirectory()) {
      if (pattern.includes("**") || pattern.includes("/")) {
        await walkGlob(full, rel, pattern, maxResults, results);
      }
      continue;
    }

    const basename = pattern.includes("/") ? rel : entry.name;
    if (matcher.test(basename) || matcher.test(rel)) {
      results.push(rel);
    }
  }

  return results;
}

export const globFilesTool = tool(
  async ({ pattern, path: searchPath = ".", max_results = 50 }) => {
    if (!pattern?.trim()) return "Error: pattern is required";

    const rootAbs = resolveSafePath(searchPath);
    const rootRel =
      path.relative(resolveSafePath("."), rootAbs).replace(/\\/g, "/") || ".";
    const maxResults = Math.min(Math.max(max_results, 1), 100);

    const matches = await walkGlob(rootAbs, rootRel, pattern.trim(), maxResults);

    if (!matches.length) {
      return `No files matching "${pattern}" under ${rootRel}`;
    }

    return [
      `=== GLOB: ${pattern} under ${rootRel} ===`,
      `Found ${matches.length} file(s):`,
      "",
      matches.join("\n"),
    ].join("\n");
  },
  {
    name: "glob_files",
    description:
      "Find files by glob pattern (e.g. **/*.vue, src/**/*.ts). Use before read_file to locate paths.",
    schema: z.object({
      pattern: z.string().describe('Glob pattern like "**/*.vue" or "src/**/*.ts"'),
      path: z
        .string()
        .optional()
        .describe("Root directory relative to workspace (default: agent cwd)"),
      max_results: z.number().optional().describe("Max files to return (default 50)"),
    }),
  },
);
