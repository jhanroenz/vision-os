#!/usr/bin/env node
/**
 * Build a portable SearXNG virtualenv using the bundled Python runtime.
 * Source is copied from vendor/searxng-src (no git clone in CI).
 */
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'src-tauri/bundle-runtime');
const vendorDir = join(root, 'vendor/searxng-src');
const pythonRoot = join(out, 'python');
const venvDir = join(out, 'searxng-venv');
const srcDir = join(out, 'searxng-src');

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

function hasVendoredSearxng() {
  return (
    existsSync(join(vendorDir, 'searx', 'webapp.py')) ||
    existsSync(join(vendorDir, 'setup.py')) ||
    existsSync(join(vendorDir, 'pyproject.toml'))
  );
}

function stageSearxngSource() {
  if (!hasVendoredSearxng()) {
    throw new Error(
      'vendor/searxng-src is missing. On Linux/macOS run: npm run vendor:searxng'
    );
  }

  const revPath = join(vendorDir, 'VENDOR_REVISION');
  if (existsSync(revPath)) {
    console.log('Using vendored SearXNG', readFileSync(revPath, 'utf8').trim());
  } else {
    console.log('Using vendored SearXNG from', vendorDir);
  }

  rmSync(srcDir, { recursive: true, force: true });
  cpSync(vendorDir, srcDir, { recursive: true });
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
    run(`"${vpy}" -m pip install -U lxml`);
  }

  stageSearxngSource();
  run(`"${vpy}" -m pip install --use-pep517 --no-build-isolation -e .`, { cwd: srcDir });

  console.log('SearXNG virtualenv ready at', venvDir);
}

main();
