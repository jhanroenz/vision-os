import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  analyzeBashCommand,
  formatInteractiveBlockMessage,
} from "../nonInteractiveScaffold.js";
import { isDevServerCommand, formatDevServerBlockMessage } from "../devServer.js";
import { executeShellCommand, formatCommandResult } from "../shellExec.js";

const BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+\//,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bsystemctl\s+(stop|disable|mask)\b/,
  />\s*\/dev\/sd/,
];

export const bashTool = tool(
  async ({ command, timeout = 30, cwd = "." }) => {
    const interactive = analyzeBashCommand(command);
    if (interactive.blocked) {
      return formatInteractiveBlockMessage(interactive);
    }

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return `Command blocked for safety: matches dangerous pattern`;
      }
    }

    if (isDevServerCommand(command)) {
      return formatDevServerBlockMessage(command);
    }

    const maxTimeoutCap = /\bnpm\s+create\b/i.test(command) ? 180 : 120;
    const result = await executeShellCommand({
      command,
      cwd,
      timeout,
      maxTimeoutCap,
    });

    return formatCommandResult(result);
  },
  {
    name: "run_bash",
    description:
      "Execute a non-interactive bash command in the workspace. " +
      "NEVER use interactive scaffolders (npm create vue@latest, vue create, npm init without -y). " +
      "NEVER chain npm run dev — dev servers are blocked; use run_check or verify_project for build/lint/test. " +
      "For new projects: npm create vite@latest <dir> -- --template vue, or write_file package.json + entry files then npm install. " +
      "For verification steps prefer run_check (structured label + pass/fail). " +
      "Returns stdout/stderr.",
    schema: z.object({
      command: z.string().describe("The bash command to execute"),
      timeout: z
        .number()
        .optional()
        .describe("Timeout in seconds (5-120, default 30)"),
      cwd: z
        .string()
        .optional()
        .describe("Relative working directory within workspace (default: agent cwd)"),
    }),
  },
);
