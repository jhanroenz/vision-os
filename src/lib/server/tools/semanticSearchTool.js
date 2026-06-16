import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { runSemanticSearch } from "../codebase/searchIndex.js";

export const semanticSearchTool = tool(
  async ({ query, path: searchPath, limit, reindex }) => {
    return runSemanticSearch(query, {
      path: searchPath,
      limit,
      forceReindex: Boolean(reindex),
    });
  },
  {
    name: "semantic_search",
    description:
      "Hybrid semantic + keyword codebase search (retriv: BM25 + local embeddings). " +
      "Finds relevant code by meaning — e.g. 'authentication flow', 'chat state store', 'verify before handoff'. " +
      "Use alongside grep_code (exact symbols) and glob_files (file patterns). Auto-indexes on first use.",
    schema: z.object({
      query: z
        .string()
        .describe("Natural language or concept query — what you are looking for in the codebase"),
      path: z
        .string()
        .optional()
        .describe("Directory to search relative to workspace (default: active project or agent cwd)"),
      limit: z.number().optional().describe("Max results (default from config, max 20)"),
      reindex: z
        .boolean()
        .optional()
        .describe("Force re-index changed files before searching"),
    }),
  },
);
