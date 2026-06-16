import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pty from 'node-pty';
import { config } from './config.js';

/** Interactive PTY sessions for the VisionOS Terminal app (not agent shell). */
const sessions = new Map();

class InteractiveTerminal {
  constructor(id, options = {}) {
    this.id = id;
    this.cwd = options.cwd ?? path.resolve(config.workspaceDir);
    this.shell = process.env.SHELL || 'bash';
    this.listeners = new Set();
    this.pendingOutput = '';
    this.closed = false;
    this.exitCode = null;

    this.pty = pty.spawn(this.shell, [], {
      name: 'xterm-256color',
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cwd: this.cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: process.env.LANG ?? 'C.UTF-8'
      }
    });

    this.pty.onData((data) => {
      if (this.listeners.size === 0) {
        this.pendingOutput += data;
        return;
      }
      for (const listener of this.listeners) listener(data);
    });

    this.pty.onExit(({ exitCode }) => {
      this.closed = true;
      this.exitCode = exitCode;
      for (const listener of this.listeners) {
        listener(null, { exitCode });
      }
      sessions.delete(this.id);
    });
  }

  subscribe(listener) {
    if (this.pendingOutput) {
      listener(this.pendingOutput);
      this.pendingOutput = '';
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  write(data) {
    if (this.closed) return false;
    this.pty.write(data);
    return true;
  }

  resize(cols, rows) {
    if (this.closed) return;
    this.pty.resize(cols, rows);
  }

  kill() {
    if (this.closed) return;
    try {
      this.pty.kill();
    } catch {
      // already exited
    }
    this.closed = true;
    sessions.delete(this.id);
  }
}

export function spawnTerminal(options = {}) {
  const id = randomUUID();
  const session = new InteractiveTerminal(id, options);
  sessions.set(id, session);
  return {
    id,
    cwd: session.cwd,
    shell: session.shell
  };
}

export function getTerminalSession(id) {
  return sessions.get(id) ?? null;
}

export function writeTerminalInput(id, data) {
  const session = sessions.get(id);
  if (!session) return false;
  return session.write(data);
}

export function resizeTerminal(id, cols, rows) {
  const session = sessions.get(id);
  if (!session) return false;
  session.resize(cols, rows);
  return true;
}

export function closeTerminal(id) {
  const session = sessions.get(id);
  if (!session) return false;
  session.kill();
  return true;
}
