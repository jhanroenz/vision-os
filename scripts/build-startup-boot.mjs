#!/usr/bin/env node
/**
 * Bundle the packaged Tauri startup splash (3D logo + holo + progress API).
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'src-tauri', 'assets');
const css = readFileSync(join(root, 'src', 'lib', 'boot', 'boot-screen.css'), 'utf8');

await build({
  entryPoints: [join(root, 'src', 'lib', 'boot', 'startup-boot.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  outfile: join(assetsDir, 'startup-boot.bundle.js'),
  logLevel: 'info'
});

const js = readFileSync(join(assetsDir, 'startup-boot.bundle.js'), 'utf8');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VisionOS</title>
  <style>
${css}
  </style>
</head>
<body>
  <script>
${js}
  </script>
</body>
</html>
`;

writeFileSync(join(assetsDir, 'startup-boot.html'), html, 'utf8');
console.log('Wrote src-tauri/assets/startup-boot.html');
