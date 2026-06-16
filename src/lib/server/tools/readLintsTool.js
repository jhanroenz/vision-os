import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { runReadLints } from "../codeCheck/readLints.js";

export const readLintsTool = tool(
  async ({ path: targetPath }) => runReadLints(targetPath),
  {
    name: "read_lints",
    description:
      "Run project-native linters/typecheckers scoped to a file or directory " +
      "(eslint, vue-tsc, tsc, ruff, cargo check, go vet). " +
      "Falls back gracefully when no linter is configured — use check_syntax for universal parse checks.",
    schema: z.object({
      path: z
        .string()
        .describe("Workspace-relative file or directory to lint"),
    }),
  },
);
