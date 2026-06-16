#!/usr/bin/env node
/**
 * Refresh vendor/searxng-src from upstream (run on Linux/macOS).
 * Excludes deployment templates with ':' in filenames (invalid on Windows NTFS).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const vendorDir = join(root, 'vendor/searxng-src');
const SEARXNG_GIT_REF = process.env.SEARXNG_GIT_REF || 'master';
const SEARXNG_REPO = 'https://github.com/searxng/searxng.git';

/** Dirs under utils/templates/etc that contain NTFS-invalid ':' filenames. */
const SPARSE_EXCLUDES = [
  '!utils/templates/etc/httpd',
  '!utils/templates/etc/nginx',
  '!utils/templates/etc/uwsgi'
];

function runGit(args, opts = {}) {
  execFileSync('git', args, { stdio: 'inherit', ...opts });
}

function main() {
  const temp = join(tmpdir(), `visionos-searxng-vendor-${Date.now()}`);
  mkdirSync(temp, { recursive: true });

  console.log(`Fetching SearXNG @ ${SEARXNG_GIT_REF}…`);
  runGit([
    'clone',
    '--no-checkout',
    '--depth',
    '1',
    '--branch',
    SEARXNG_GIT_REF,
    SEARXNG_REPO,
    temp
  ]);
  runGit(['sparse-checkout', 'init', '--no-cone'], { cwd: temp });
  runGit(['sparse-checkout', 'set', '/*', ...SPARSE_EXCLUDES], { cwd: temp });
  runGit(['checkout', SEARXNG_GIT_REF], { cwd: temp });

  const rev = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: temp, encoding: 'utf8' }).trim();

  rmSync(vendorDir, { recursive: true, force: true });
  cpSync(temp, vendorDir, { recursive: true });
  rmSync(join(vendorDir, '.git'), { recursive: true, force: true });

  writeFileSync(
    join(vendorDir, 'VENDOR_REVISION'),
    `${SEARXNG_GIT_REF} ${rev}\n`,
    'utf8'
  );

  rmSync(temp, { recursive: true, force: true });
  console.log('Vendored SearXNG at', vendorDir, `(${rev.slice(0, 12)})`);
}

main();
