import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  analyzeBashCommand,
  formatInteractiveBlockMessage,
} from "../nonInteractiveScaffold.js";
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

export const runCheckTool = tool(
  async ({ command, label, cwd = ".", timeout = 60 }) => {
    const interactive = analyzeBashCommand(command);
    if (interactive.blocked) {
      return formatInteractiveBlockMessage(interactive);
    }

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return `RESULT: FAILED (exit 1)\nCommand blocked for safety: matches dangerous pattern`;
      }
    }

    const checkLabel = String(label ?? command).trim().slice(0, 120);
    const result = await executeShellCommand({
      command,
      cwd,
      timeout,
      maxTimeoutCap: 180,
    });

    return formatCommandResult({ ...result, label: checkLabel });
  },
  {
    name: "run_check",
    description:
      "Run a named verification command (build, lint, test) with structured pass/fail output. " +
      "Prefer this over run_bash for verification steps — the label appears in the activity timeline.",
    schema: z.object({
      command: z.string().describe("Shell command to run"),
      label: z
        .string()
        .describe("Short human label, e.g. 'npm run build' or 'pytest'"),
      cwd: z
        .string()
        .optional()
        .describe("Relative working directory (default: agent cwd)"),
      timeout: z
        .number()
        .optional()
        .describe("Timeout in seconds (5-180, default 60)"),
    }),
  },
);
