import path from "node:path";
import fs from "node:fs/promises";
import { bashTool } from "./tools/bashTool.js";
import { listDirectoryTool } from "./tools/fileTools.js";
import {
  getThreadCwd,
  setThreadCwd,
  resolveSafePath,
  updateCwdFromTool,
  joinWorkspacePath,
  sanitizeWorkspaceRelativePath,
} from "./workspace.js";

function stripQuotes(text) {
  return text.trim().replace(/^["']|["']$/g, "");
}

function resolveRelativePath(threadId, target) {
  return joinWorkspacePath(getThreadCwd(threadId), target);
}

async function ensureDirExists(relativePath) {
  const full = resolveSafePath(relativePath);
  const stat = await fs.stat(full);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${relativePath}`);
  }
}

/** Parse input when the UI composer is in Command mode. */
export function parseCommandModeInput(message) {
  const text = message.trim();
  if (!text) return null;
  if (text.includes("\n")) {
    return { kind: "invalid", reason: "Command cannot contain newlines." };
  }

  let match;

  if ((match = text.match(/^cd(?:\s+(.+))?$/i))) {
    return { kind: "cd", target: match[1]?.trim() ?? "." };
  }

  if (/^pwd$/i.test(text)) {
    return { kind: "pwd" };
  }

  if ((match = text.match(/^ls(?:\s+(.+))?$/i))) {
    return { kind: "ls", target: match[1]?.trim() };
  }

  if ((match = text.match(/^mkdir(?:\s+-p)?\s+(.+)$/i))) {
    return { kind: "mkdir", target: match[1].trim(), recursive: /-p/.test(text) };
  }

  return { kind: "bash", command: text, interactive: true };
}

export async function runDirectCommand(threadId, parsed) {
  const toolEvents = [];

  switch (parsed.kind) {
    case "cd": {
      const next = resolveRelativePath(threadId, parsed.target ?? ".");
      await ensureDirExists(next);
      await setThreadCwd(threadId, next);
      const reply = `Changed directory to ${next}`;
      toolEvents.push(
        { type: "tool_call", name: "run_bash", args: { command: `cd ${parsed.target ?? "."}` } },
        { type: "tool_result", name: "run_bash", content: reply },
      );
      return { reply, toolEvents, direct: true };
    }

    case "pwd": {
      const cwd = getThreadCwd(threadId);
      const reply = cwd === "." ? "." : cwd;
      toolEvents.push(
        { type: "tool_call", name: "run_bash", args: { command: "pwd" } },
        { type: "tool_result", name: "run_bash", content: reply },
      );
      return { reply, toolEvents, direct: true };
    }

    case "ls": {
      const dirPath = parsed.target
        ? resolveRelativePath(threadId, parsed.target)
        : getThreadCwd(threadId);
      const listing = await listDirectoryTool.invoke({ path: dirPath });
      toolEvents.push(
        { type: "tool_call", name: "list_directory", args: { path: dirPath } },
        { type: "tool_result", name: "list_directory", content: listing.slice(0, 2000) },
      );
      return { reply: listing, toolEvents, direct: true };
    }

    case "mkdir": {
      const dirPath = resolveRelativePath(threadId, parsed.target);
      const full = resolveSafePath(dirPath);
      await fs.mkdir(full, { recursive: parsed.recursive ?? false });
      const reply = `Created directory ${dirPath}`;
      toolEvents.push(
        {
          type: "tool_call",
          name: "run_bash",
          args: { command: `mkdir ${parsed.recursive ? "-p " : ""}${parsed.target}` },
        },
        { type: "tool_result", name: "run_bash", content: reply },
      );
      return { reply, toolEvents, direct: true };
    }

    case "bash": {
      if (parsed.interactive) {
        return {
          direct: true,
          interactive: true,
          command: parsed.command,
          toolEvents: [],
        };
      }

      const cwd = getThreadCwd(threadId);
      const result = await bashTool.invoke({
        command: parsed.command,
        cwd,
      });
      await updateCwdFromTool(threadId, "run_bash", {
        command: parsed.command,
        cwd,
      });
      toolEvents.push(
        { type: "tool_call", name: "run_bash", args: { command: parsed.command, cwd } },
        { type: "tool_result", name: "run_bash", content: result.slice(0, 2000) },
      );
      return { reply: result, toolEvents, direct: true };
    }

    default:
      return null;
  }
}

export async function runCommandMode(threadId, message) {
  const parsed = parseCommandModeInput(message);
  if (!parsed) {
    return {
      reply: "Empty command.",
      toolEvents: [],
      direct: true,
      error: true,
    };
  }

  if (parsed.kind === "invalid") {
    return {
      reply: parsed.reason,
      toolEvents: [],
      direct: true,
      error: true,
    };
  }

  try {
    return await runDirectCommand(threadId, parsed);
  } catch (error) {
    return {
      reply: error.message,
      toolEvents: [
        {
          type: "tool_call",
          name: "direct_command",
          args: parsed,
        },
        {
          type: "tool_result",
          name: "direct_command",
          content: error.message,
        },
      ],
      direct: true,
      error: true,
    };
  }
}
