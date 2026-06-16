#!/usr/bin/env node
/**
 * Download and extract a portable Node.js runtime into src-tauri/bundle-runtime/node.
 *
 * Usage:
 *   node scripts/download-node.mjs
 *   node scripts/download-node.mjs --platform linux --arch x64
 *   node scripts/download-node.mjs --platform win32 --arch x64
 *   node scripts/download-node.mjs --platform darwin --arch arm64
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
import { execSync } from 'node:child_process';
import { Readable } from 'node:stream';

const NODE_VERSION = process.env.NODE_VERSION || '22.16.0';
const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'src-tauri/bundle-runtime/node');

function parseArgs() {
  const args = process.argv.slice(2);
  let platform = process.platform;
  let arch = process.arch;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform' && args[i + 1]) platform = args[++i];
    if (args[i] === '--arch' && args[i + 1]) arch = args[++i];
  }

  return { platform, arch };
}

function nodeDist(platform, arch) {
  if (platform === 'win32') {
    return { ext: 'zip', folder: `node-v${NODE_VERSION}-win-${arch}` };
  }
  const map = { linux: 'linux', darwin: 'darwin' };
  const os = map[platform];
  if (!os) throw new Error(`Unsupported platform: ${platform}`);
  return { ext: 'tar.xz', folder: `node-v${NODE_VERSION}-${os}-${arch}` };
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

/** Extract Node archives cross-platform (Windows GHA has tar, not unzip). */
function extractArchive(archive, ext, destDir) {
  if (ext === 'zip') {
    execSync(`tar -xf "${archive}" -C "${destDir}"`, { stdio: 'inherit' });
    return;
  }
  execSync(`tar -xJf "${archive}" -C "${destDir}"`, { stdio: 'inherit' });
}

async function main() {
  const { platform, arch } = parseArgs();
  const { ext, folder } = nodeDist(platform, arch);
  const fileName = `${folder}.${ext}`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${fileName}`;
  const cache = resolve(root, '.cache');
  const archive = join(cache, fileName);
  const extractRoot = join(cache, folder);

  mkdirSync(cache, { recursive: true });
  rmSync(outDir, { recursive: true, force: true });

  if (!existsSync(archive)) {
    console.log('Downloading', url);
    await download(url, archive);
  } else {
    console.log('Using cached', archive);
  }

  rmSync(extractRoot, { recursive: true, force: true });

  extractArchive(archive, ext, cache);

  cpSync(extractRoot, outDir, { recursive: true });
  console.log('Node runtime ready at', outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
