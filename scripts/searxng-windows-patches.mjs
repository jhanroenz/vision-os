import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VALKEYDB_GUARD = 'VISIONOS_WINDOWS_VALKEY_GUARD';

function patchValkeydbFile(file) {
  if (!existsSync(file)) return false;

  let text = readFileSync(file, 'utf8');
  if (text.includes(VALKEYDB_GUARD)) return false;

  if (!text.includes('import pwd')) {
    console.warn('Could not patch valkeydb.py for Windows (upstream changed):', file);
    return false;
  }

  text = text.replace(
    /import os\r?\nimport pwd\r?\nimport logging/,
    `import os\n\ntry:\n    import pwd\nexcept ImportError:  # ${VALKEYDB_GUARD}\n    pwd = None  # type: ignore\n\nimport logging`
  );

  text = text.replace(
    /        _pw = pwd\.getpwuid\(os\.getuid\(\)\)\r?\n        logger\.exception\("\[%s \(%s\)\] can't connect valkey DB \.\.\.", _pw\.pw_name, _pw\.pw_uid\)/,
    "        if pwd is not None:\n            _pw = pwd.getpwuid(os.getuid())\n            logger.exception(\"[%s (%s)] can't connect valkey DB ...\", _pw.pw_name, _pw.pw_uid)\n        else:\n            logger.exception(\"can't connect valkey DB ...\")"
  );

  writeFileSync(file, text, 'utf8');
  console.log('Patched valkeydb.py for Windows:', file);
  return true;
}

export function patchValkeydbForWindows(srcDir, venvDir = null) {
  if (process.platform !== 'win32') return;

  patchValkeydbFile(join(srcDir, 'searx', 'valkeydb.py'));

  if (venvDir) {
    patchValkeydbFile(join(venvDir, 'Lib', 'site-packages', 'searx', 'valkeydb.py'));
  }
}

export function patchCommandEngineForWindows(srcDir) {
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

  if (!pattern.test(text)) {
    console.warn('Could not patch command.py for Windows (upstream changed)');
    return;
  }

  writeFileSync(file, text.replace(pattern, replacement), 'utf8');
  console.log('Patched searx/engines/command.py for Windows');
}

export function patchBundledSearxngSources(srcDir, venvDir = null) {
  patchValkeydbForWindows(srcDir, venvDir);
  patchCommandEngineForWindows(srcDir);
}
