#!/usr/bin/env node
/**
 * CI check: bundled runtime must not ship secrets or dev databases.
 * Templates like `.env.example` are allowed.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const bundleRoot = resolve(root, 'src-tauri/bundle-runtime');

function isBlockedEnvFile(name) {
  if (name === '.env') return true;
  if (!name.startsWith('.env.')) return false;
  return !name.endsWith('.example');
}

function walk(dir, bad) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, bad);
      continue;
    }
    if (name === 'jarvis.db' || isBlockedEnvFile(name)) {
      bad.push(full);
    }
  }
}

const bad = [];
if (!existsSync(bundleRoot)) {
  console.error('bundle-runtime not found at', bundleRoot);
  process.exit(1);
}
if (statSync(bundleRoot).isDirectory()) {
  walk(bundleRoot, bad);
}

if (bad.length) {
  console.error(
    'Bundle must not ship .env files (templates like .env.example are OK) or jarvis.db',
  );
  for (const path of bad) console.error(path);
  process.exit(1);
}

console.log('Bundle secret check passed');
