#!/usr/bin/env node
/**
 * Build a portable SearXNG virtualenv using the bundled Python runtime.
 */
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'src-tauri/bundle-runtime');
const pythonRoot = join(out, 'python');
const venvDir = join(out, 'searxng-venv');
const srcDir = join(out, 'searxng-src');
const SEARXNG_GIT_REF = process.env.SEARXNG_GIT_REF || 'master';

function pythonBin() {
  if (process.platform === 'win32') {
    return join(pythonRoot, 'python.exe');
  }
  const candidates = [
    join(pythonRoot, 'bin', 'python3'),
    join(pythonRoot, 'bin', 'python'),
    join(pythonRoot, 'python')
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(`Bundled Python not found under ${pythonRoot}`);
}

function venvPython() {
  if (process.platform === 'win32') {
    return join(venvDir, 'Scripts', 'python.exe');
  }
  return join(venvDir, 'bin', 'python');
}

function run(cmd, opts = {}) {
  execSync(cmd, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts
  });
}

function ensureSearxngSource() {
  if (existsSync(join(srcDir, '.git'))) {
    console.log('Updating SearXNG source…');
    run('git fetch --depth 1 origin', { cwd: srcDir });
    run(`git checkout ${SEARXNG_GIT_REF}`, { cwd: srcDir });
    run('git pull --ff-only origin ' + SEARXNG_GIT_REF, { cwd: srcDir });
    return;
  }

  rmSync(srcDir, { recursive: true, force: true });
  run(
    `git clone --depth 1 --branch ${SEARXNG_GIT_REF} https://github.com/searxng/searxng.git "${srcDir}"`
  );
}

function main() {
  if (!existsSync(pythonRoot)) {
    throw new Error('Run npm run prepare:python before prepare:searxng-python');
  }

  const py = pythonBin();
  console.log('Creating SearXNG virtualenv…');
  rmSync(venvDir, { recursive: true, force: true });
  run(`"${py}" -m venv "${venvDir}"`);

  const vpy = venvPython();
  run(`"${vpy}" -m pip install -U pip setuptools wheel`);
  run(
    `"${vpy}" -m pip install -U pyyaml msgspec typing-extensions pybind11 babel jinja2 flask`
  );
  if (process.platform === 'win32') {
    // Prefer wheels for native deps before editable SearXNG install.
    run(`"${vpy}" -m pip install -U lxml`);
  }

  ensureSearxngSource();
  run(`"${vpy}" -m pip install --use-pep517 --no-build-isolation -e .`, { cwd: srcDir });

  console.log('SearXNG virtualenv ready at', venvDir);
}

main();
