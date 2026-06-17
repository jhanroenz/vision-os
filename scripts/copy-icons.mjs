#!/usr/bin/env node
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const src = join(root, 'src-tauri', 'icons', 'icon.ico');
const dest = join(root, 'static', 'favicon.ico');

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`Copied ${src} → ${dest}`);
