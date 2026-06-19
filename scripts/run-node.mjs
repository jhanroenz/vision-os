#!/usr/bin/env node
/**
 * Run a Node script with flags required by VisionOS (retriv → node:sqlite on Node 22.5–22.12).
 * Usage: node scripts/run-node.mjs <entry.js> [...args]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const entry = process.argv[2];
const rest = process.argv.slice(3);

if (!entry) {
  console.error('Usage: node scripts/run-node.mjs <entry.js> [...args]');
  process.exit(1);
}

const entryPath = resolve(entry);
if (!existsSync(entryPath)) {
  console.error(`Entry not found: ${entryPath}`);
  process.exit(1);
}

const nodeArgs = [];
const [major, minor] = process.versions.node.split('.').map(Number);
if (major === 22 && minor < 13) {
  nodeArgs.push('--experimental-sqlite');
}

const child = spawn(process.execPath, [...nodeArgs, entryPath, ...rest], {
  stdio: 'inherit',
  env: process.env,
  cwd: process.cwd(),
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
