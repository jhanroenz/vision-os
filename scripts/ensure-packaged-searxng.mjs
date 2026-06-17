#!/usr/bin/env node
/**
 * Rebuild the bundled SearXNG virtualenv on the end-user machine.
 * Used when CI-built venv paths (pyvenv.cfg / editable install) are invalid after install.
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const root = resolve(process.env.VISIONOS_BUNDLE_ROOT ?? process.argv[2] ?? '');
if (!root) {
  throw new Error('VISIONOS_BUNDLE_ROOT is required');
}

const pythonRoot = join(root, 'python');
const venvDir = join(root, 'searxng-venv');
const srcDir = join(root, 'searxng-src');

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

function patchCommandEngineForWindows() {
  if (process.platform !== 'win32') return;

  const file = join(srcDir, 'searx', 'engines', 'command.py');
  if (!existsSync(file)) return;
  let text = readFileSync(file, 'utf8');
  if (text.includes('VISIONOS_WINDOWS_GUARD')) return;

  const pattern = /def search\(query, params\) -> EngineResults:\r?\n(\s+)res = EngineResults\(\)/;
  const replacement =
    'def search(query, params) -> EngineResults:\n' +
    "    import os\n" +
    "    if os.name == 'nt':  # VISIONOS_WINDOWS_GUARD\n" +
    '        return EngineResults()\n' +
    '    res = EngineResults()';

  if (!pattern.test(text)) return;
  writeFileSync(file, text.replace(pattern, replacement), 'utf8');
}

function main() {
  if (!existsSync(join(srcDir, 'searx', 'webapp.py'))) {
    throw new Error(`Bundled SearXNG source missing at ${srcDir}`);
  }

  const py = pythonBin();
  console.log('Rebuilding SearXNG virtualenv at', venvDir);
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

  patchCommandEngineForWindows();
  run(`"${vpy}" -m pip install --use-pep517 --no-build-isolation .`, { cwd: srcDir });

  run(`"${vpy}" -c "import searx"`);
  console.log('SearXNG virtualenv ready');
}

main();
