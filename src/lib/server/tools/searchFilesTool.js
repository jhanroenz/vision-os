import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  buildWorkspaceFileMap,
  resolveFileMapScanRoot,
} from "../workspaceFileMap.js";
import { getWorkspaceFileMap } from "../fileContext.js";
import {
  searchFilePaths,
  formatSearchFilesResult,
} from "../filePathSearch.js";
import { getThreadCwd, getLockedProjectRoot, getActiveProjectRoot } from "../workspace.js";

function normalizeRoot(root) {
  return String(root ?? ".")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "") || ".";
}

export function createSearchFilesTool(ctx = {}) {
  return tool(
    async ({ query, path: searchRoot, max_results = 25 }) => {
      const q = String(query ?? "").trim();
      if (!q) {
        return "RESULT: FAILED (exit 1)\nquery is required — e.g. App.vue, package.json, or src/**/*.vue";
      }

      const threadId = ctx.threadId ?? "default";
      const cwd = getThreadCwd(threadId) ?? ".";
      const locked = getLockedProjectRoot(threadId);
      const scanRoot = normalizeRoot(
        (searchRoot && String(searchRoot).trim()) ||
          (locked && locked !== "." ? locked : null) ||
          resolveFileMapScanRoot(threadId),
      );

      let paths = [];
      let truncated = false;
      const cached = getWorkspaceFileMap(threadId);
      if (cached?.scanRoot === scanRoot) {
        paths = cached.paths.map((p) => p.replace(/^\.\//, ""));
        truncated = cached.truncated;
      } else {
        const map = await buildWorkspaceFileMap(scanRoot);
        paths = map.paths.map((p) => p.replace(/^\.\//, ""));
        truncated = map.truncated;
      }

      const matches = searchFilePaths(paths, q, max_results);
      const active = getActiveProjectRoot(threadId);

      return formatSearchFilesResult({
        query: q,
        cwd: locked && locked !== "." ? locked : active && active !== "." ? active : cwd,
        scanRoot,
        matches,
        truncated,
      });
    },
    {
      name: "search_files",
      description:
        "Resolve exact workspace file paths before search_replace or delete_file on existing files. " +
        "Search by filename (App.vue), partial path (src/App), or glob (**/*.vue). " +
        "Returns paths relative to workspace and, when applicable, relative to agent cwd. " +
        "Recommended before write_file on existing files; new files can be written without a match. " +
        "Server requires a matching search_files result before search_replace or delete_file.",
      schema: z.object({
        query: z
          .string()
          .describe('Filename, partial path, or glob — e.g. "App.vue", "package.json", "src/**/*.vue"'),
        path: z
          .string()
          .optional()
          .describe("Optional scan root (default: locked/active project or cwd)"),
        max_results: z
          .number()
          .optional()
          .describe("Max matches to return (default 25)"),
      }),
    },
  );
}
