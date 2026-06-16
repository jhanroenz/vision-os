import { initDatabase } from './db.js';
import { initSettings } from './settings.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { visionRoot } from './env';

let ready = false;

function ensureSearxngOnStartup() {
  if (process.env.SEARXNG_AUTO_START === 'false') return;

  const script = path.join(visionRoot, 'searxng/ensure.sh');
  const child = spawn('bash', [script], {
    cwd: visionRoot,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  console.log('[VisionOS] Ensuring SearXNG is running…');
}

/** Boot VisionOS Jarvis backend (DB, settings, workspace dirs). */
export async function initVisionOS() {
  if (ready) return;

  await initDatabase();
  await initSettings();

  await fs.mkdir(config.workspaceDir, { recursive: true });

  ensureSearxngOnStartup();

  ready = true;
  console.log('[VisionOS] Backend initialized');
  console.log(`[VisionOS] Database: ${config.dbPath}`);
  console.log(`[VisionOS] Workspace: ${config.workspaceDir}`);
}
