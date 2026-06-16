#!/usr/bin/env node
/**
 * Download portable CPython (python-build-standalone) into bundle-runtime/python.
 */
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { extractArchive } from './archive.js';

const RELEASE = process.env.PYTHON_STANDALONE_RELEASE || '20250317';
const CPYTHON = process.env.PYTHON_VERSION || '3.12.9';
const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'src-tauri/bundle-runtime/python');

const TARGETS = {
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin'
};

function releaseAssetName(target) {
  return `cpython-${CPYTHON}+${RELEASE}-${target}-install_only.tar.gz`;
}

function releaseAssetUrl(target) {
  const name = releaseAssetName(target);
  // GitHub release assets use literal '+' in the filename (do not URL-encode).
  return `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE}/${name}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let platform = process.platform;
  let arch = process.arch;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform' && args[i + 1]) platform = args[++i];
    if (args[i] === '--arch' && args[i + 1]) arch = args[++i];
  }
  const key = `${platform}-${arch}`;
  const target = TARGETS[key];
  if (!target) {
    throw new Error(`Unsupported Python target: ${key}`);
  }
  return { platform, arch, target };
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function main() {
  const { platform, target } = parseArgs();
  const file = releaseAssetName(target);
  const url = releaseAssetUrl(target);
  const cache = resolve(root, '.cache');
  const archive = join(cache, file);
  const extractDir = join(cache, `python-extract-${target}`);

  mkdirSync(cache, { recursive: true });
  rmSync(outDir, { recursive: true, force: true });
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });

  if (!existsSync(archive)) {
    console.log('Downloading', url);
    await download(url, archive);
  } else {
    console.log('Using cached', archive);
  }

  extractArchive(archive, 'tar.gz', extractDir, platform);
  const pythonDir = join(extractDir, 'python');
  if (!existsSync(pythonDir)) {
    throw new Error(`Expected python/ directory in ${extractDir}`);
  }
  cpSync(pythonDir, outDir, { recursive: true });
  console.log('Python runtime ready at', outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
