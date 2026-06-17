#!/usr/bin/env node
/**
 * Save the SearXNG Docker image for offline/portable VisionOS installs.
 * Cross-platform replacement for scripts/bundle-searxng-image.sh.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { containerEngine } from '../searxng/lib.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = join(root, 'src-tauri', 'bundle-runtime', 'docker', 'searxng-image.tar');
const image = process.env.SEARXNG_IMAGE ?? 'searxng/searxng:latest';
const tag = 'visionos-searxng:local';

function run(engine, args) {
  const result = spawnSync(engine, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed: ${engine} ${args.join(' ')}`);
  }
}

const engine = containerEngine();
if (!engine) {
  console.error('Docker or Podman is required to bundle the SearXNG image.');
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });

console.log(`Pulling ${image}…`);
run(engine, ['pull', image]);
run(engine, ['tag', image, tag]);
console.log(`Saving ${tag} → ${out}`);
run(engine, ['save', tag, '-o', out]);
console.log('Bundled SearXNG image at', out);
