#!/usr/bin/env node
/**
 * Stage portable runtime files under src-tauri/bundle-runtime for Tauri resources.
 * Run on the same OS/arch as the release build (native modules must match).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'src-tauri/bundle-runtime');
const server = join(out, 'server');

/** Packaged SearXNG listens on an uncommon localhost port (see src/lib/server/ports.js). */
const PACKAGED_SEARXNG_PORT = 37583;

const PRESERVED_DIRS = ['python', 'searxng-venv', 'searxng-src'];

const PACKAGED_SEARXNG_SETTINGS = `# Packaged SearXNG config for VisionOS (bundled Python, no Docker).
# Dev Docker still uses searxng/core-config/settings.yml in the repo tree.

use_default_settings: true

server:
  secret_key: "3669962bb5d9d84d00ac4a842e7f70582c210d183ba21984f371c96ebaf655dd"
  bind_address: "127.0.0.1"
  port: ${PACKAGED_SEARXNG_PORT}
  limiter: false
  image_proxy: false
  base_url: "http://127.0.0.1:${PACKAGED_SEARXNG_PORT}/"

search:
  safe_search: 0
  formats:
    - html
    - json
`;

function run(cmd, cwd = root) {
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function stripEnvFiles(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      stripEnvFiles(full);
      continue;
    }
    if (name === '.env' || (name.startsWith('.env.') && !name.endsWith('.example'))) {
      rmSync(full, { force: true });
      console.warn('Removed secret file from bundle:', full);
    }
    if (name === 'jarvis.db' || name.endsWith('.db-wal') || name.endsWith('.db-shm')) {
      rmSync(full, { force: true });
      console.warn('Removed database file from bundle:', full);
    }
  }
}

function backupDir(name) {
  const src = join(out, name);
  if (!existsSync(src)) return null;
  const dest = join(tmpdir(), `visionos-${name}-${Date.now()}`);
  mkdirSync(dest, { recursive: true });
  cpSync(src, join(dest, name), { recursive: true });
  return { name, dest: join(dest, name) };
}

function restoreDir({ name, dest }) {
  cpSync(dest, join(out, name), { recursive: true });
  rmSync(join(dest, '..'), { recursive: true, force: true });
}

if (!existsSync(join(root, 'build', 'index.js'))) {
  console.log('No production build found — running vite build…');
  run('npm run build');
}

console.log('Preparing bundle-runtime…');
const backups = PRESERVED_DIRS.map(backupDir).filter(Boolean);

rmSync(out, { recursive: true, force: true });
mkdirSync(server, { recursive: true });

for (const backup of backups) {
  restoreDir(backup);
}

cpSync(join(root, 'build'), join(server, 'build'), { recursive: true });
cpSync(join(root, 'package.json'), join(server, 'package.json'));
cpSync(join(root, 'package-lock.json'), join(server, 'package-lock.json'));

console.log('Installing production Node dependencies…');
run('npm ci --omit=dev', server);
run('npm rebuild better-sqlite3 node-pty', server);

cpSync(join(root, 'searxng'), join(out, 'searxng'), { recursive: true });
mkdirSync(join(out, 'searxng', 'core-config'), { recursive: true });
writeFileSync(join(out, 'searxng', 'core-config', 'settings.yml'), PACKAGED_SEARXNG_SETTINGS);

stripEnvFiles(out);

console.log('bundle-runtime ready at', out);
