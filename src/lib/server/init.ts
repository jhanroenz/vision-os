import { initDatabase } from './db.js';
import { initSettings } from './settings.js';
import fs from 'node:fs/promises';
import { config } from './config.js';

let ready = false;

/** Boot VisionOS Jarvis backend (DB, settings, workspace dirs). */
export async function initVisionOS() {
  if (ready) return;

  await initDatabase();
  await initSettings();

  await fs.mkdir(config.workspaceDir, { recursive: true });

  ready = true;
  console.log('[VisionOS] Backend initialized');
  console.log(`[VisionOS] Database: ${config.dbPath}`);
  console.log(`[VisionOS] Workspace: ${config.workspaceDir}`);
}
