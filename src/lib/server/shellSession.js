import pty from "node-pty";
import { resolveSafePath } from "./workspace.js";
import { getThreadCwd, updateCwdFromTool } from "./workspace.js";

const sessions = new Map();

const BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+\//,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bsystemctl\s+(stop|disable|mask)\b/,
  />\s*\/dev\/sd/,
];

const PROMPT_PATTERNS = [
  /\([yY]\/[nN]\)\s*$/,
  /\[(yes|no|y|n)\]\s*$/i,
  /[Pp]assword:\s*$/,
  /:\s*$/,
  /\?\s*$/,
  />\s*$/,
];

const IDLE_MS = 700;
const MAX_OUTPUT = 512 * 1024;

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function isBlocked(command) {
  return BLOCKED_PATTERNS.some((p) => p.test(command));
}

export function getShellSession(threadId) {
  return sessions.get(threadId) ?? null;
}

export function isShellWaiting(threadId) {
  return sessions.get(threadId)?.waiting ?? false;
}

export function cancelShellSession(threadId) {
  const session = sessions.get(threadId);
  if (!session) return false;
  session.kill();
  return true;
}

class ShellSession {
  constructor(threadId, command, cwd) {
    this.threadId = threadId;
    this.command = command;
    this.cwd = cwd;
    this.rawOutput = "";
    this.waiting = false;
    this.finished = false;
    this.exitCode = null;
    this.idleTimer = null;
    this.queue = [];
    this.waiters = [];

    this.pty = pty.spawn("bash", ["-lc", command], {
      name: "xterm-color",
      cols: 120,
      rows: 32,
      cwd: resolveSafePath(cwd),
      env: {
        ...process.env,
        TERM: "xterm-color",
        LANG: "C.UTF-8",
      },
    });

    this.pty.onData((data) => this.onData(data));
    this.pty.onExit(({ exitCode }) => this.onExit(exitCode));
  }

  push(event) {
    this.queue.push(event);
    const waiter = this.waiters.shift();
    if (waiter) waiter();
  }

  async nextEvent() {
    if (this.queue.length) return this.queue.shift();
    if (this.finished) return null;
    await new Promise((resolve) => this.waiters.push(resolve));
    return this.queue.shift() ?? null;
  }

  async *iterateEvents() {
    while (true) {
      const event = await this.nextEvent();
      if (!event) break;
      yield event;
      if (event.type === "shell_input_required" || event.type === "shell_done") {
        break;
      }
    }
  }

  onData(data) {
    this.waiting = false;
    this.rawOutput += data;
    if (this.rawOutput.length > MAX_OUTPUT) {
      this.rawOutput = this.rawOutput.slice(-MAX_OUTPUT);
    }

    this.push({ type: "shell_output", content: data });

    clearTimeout(this.idleTimer);
    if (!this.finished) {
      this.idleTimer = setTimeout(() => this.onIdle(), IDLE_MS);
    }
  }

  onIdle() {
    if (this.finished || this.waiting) return;

    const plain = stripAnsi(this.rawOutput);
    const tail = plain.slice(-500).trimEnd();
    const looksLikePrompt =
      PROMPT_PATTERNS.some((p) => p.test(tail)) ||
      /:\s*$/.test(tail) ||
      plain.length > 0;

    if (!looksLikePrompt) return;

    this.waiting = true;
    this.push({
      type: "shell_input_required",
      command: this.command,
      tail: tail.slice(-300),
    });
  }

  onExit(exitCode) {
    this.finished = true;
    this.waiting = false;
    this.exitCode = exitCode;
    clearTimeout(this.idleTimer);

    updateCwdFromTool(this.threadId, "run_bash", {
      command: this.command,
      cwd: this.cwd,
    }).catch(() => {});

    this.push({
      type: "shell_done",
      exitCode,
      output: stripAnsi(this.rawOutput),
      command: this.command,
    });

    sessions.delete(this.threadId);
  }

  writeInput(text) {
    if (this.finished) return false;
    this.waiting = false;
    this.pty.write(`${text}\r`);
    return true;
  }

  kill() {
    clearTimeout(this.idleTimer);
    if (!this.finished) {
      try {
        this.pty.kill();
      } catch {
        // already exited
      }
    }
    this.finished = true;
    this.waiting = false;
    sessions.delete(this.threadId);
  }
}

export function startShellSession(threadId, command, cwd = ".") {
  if (isBlocked(command)) {
    throw new Error(`Command blocked for safety: ${command}`);
  }

  cancelShellSession(threadId);

  const session = new ShellSession(threadId, command, cwd);
  sessions.set(threadId, session);

  return session;
}

export async function* streamShellSession(threadId, command, cwd) {
  const session = startShellSession(threadId, command, cwd);

  yield {
    type: "shell_start",
    command,
    cwd,
  };

  for await (const event of session.iterateEvents()) {
    yield event;
  }
}

export async function* continueShellSession(threadId, input) {
  const session = getShellSession(threadId);
  if (!session || !session.waiting) {
    yield {
      type: "error",
      error: "No interactive command is waiting for input",
    };
    return;
  }

  yield {
    type: "shell_input",
    content: input,
  };

  session.writeInput(input);

  for await (const event of session.iterateEvents()) {
    yield event;
  }
}

export async function finalizeShellSession(threadId) {
  const session = getShellSession(threadId);
  if (!session) return null;

  await updateCwdFromTool(threadId, "run_bash", {
    command: session.command,
    cwd: session.cwd,
  });

  return {
    command: session.command,
    exitCode: session.exitCode,
    output: stripAnsi(session.rawOutput),
  };
}
