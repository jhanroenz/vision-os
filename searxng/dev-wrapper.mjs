#!/usr/bin/env node
/**
 * Ensure SearXNG is up, run a npm script, tear Docker SearXNG down on exit.
 * Replaces searxng/dev-server.sh and searxng/tauri-dev.sh.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ensureSearxng, repoRoot, runCompose, containerEngine } from './lib.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = repoRoot();
const npmScript = process.argv[2];

if (!npmScript) {
  console.error('Usage: node searxng/dev-wrapper.mjs <npm-script>');
  process.exit(1);
}

let child;
let stopping = false;

async function stopSearxng() {
  if (stopping) return;
  stopping = true;
  if (!containerEngine()) return;
  try {
    runCompose(['down'], { root });
  } catch {
    // ignore teardown errors
  }
}

function shutdown(code = 0) {
  void stopSearxng().finally(() => process.exit(code));
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => shutdown(0));
}
process.on('exit', () => {
  if (!stopping && containerEngine()) {
    try {
      runCompose(['down'], { root });
    } catch {
      // ignore
    }
  }
});

try {
  await ensureSearxng({ root });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const isTauriDev = npmScript === 'tauri:dev:raw';
  if (isTauriDev) {
    console.warn(
      'SearXNG is not available — continuing native dev startup. Web search may fail until SearXNG is running.',
    );
    console.warn(message);
  } else {
    console.error(message);
    process.exit(1);
  }
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
child = spawn(npmCmd, ['run', npmScript], {
  cwd: resolve(__dirname, '..'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  void stopSearxng().finally(() => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
});
