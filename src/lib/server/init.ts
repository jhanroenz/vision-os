import { initDatabase } from './db.js';
import { initSettings } from './settings.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { dataDir, visionRoot } from './env';
import { isDriveOrFilesystemRoot, isPackaged } from './paths.js';

let ready = false;

async function ensureRuntimeDirs() {
  if (isDriveOrFilesystemRoot(config.workspaceDir)) {
    throw new Error(
      `Invalid WORKSPACE_DIR (${config.workspaceDir}). Set WORKSPACE_DIR in .env to a folder path, e.g. ${path.join(path.dirname(dataDir), 'workspace')}`,
    );
  }
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(config.workspaceDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, 'transcripts'), { recursive: true });
  if (isPackaged()) {
    await fs.mkdir(path.join(dataDir, 'hf-cache'), { recursive: true });
    const examplePath = path.join(dataDir, '.env.example');
    try {
      await fs.access(examplePath);
    } catch {
      const template = [
        '# Optional VisionOS user overrides (copy to .env to enable)',
        '# LLM_PROVIDER=local',
        '# LLM_BASE_URL=http://localhost:11434/v1',
        '# LLM_MODEL=your-model',
        '# OPENROUTER_API_KEY=sk-or-v1-...',
        '',
      ].join('\n');
      await fs.writeFile(examplePath, template, 'utf-8');
    }
  }
}

function ensureSearxngOnStartup() {
  if (process.env.SEARXNG_AUTO_START === 'false') return;
  if (process.env.VISIONOS_PACKAGED === 'true') return;

  const script = path.join(visionRoot, 'searxng', 'ensure.mjs');
  const child = spawn(process.execPath, [script], {
    cwd: visionRoot,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, SEARXNG_PORT: process.env.SEARXNG_PORT ?? '8080' },
  });
  child.unref();
  console.log('[VisionOS] Ensuring SearXNG is running…');
}

/** Boot VisionOS Jarvis backend (DB, settings, workspace dirs). */
export async function initVisionOS() {
  if (ready) return;

  await initDatabase();
  await initSettings();

  await ensureRuntimeDirs();

  ensureSearxngOnStartup();

  const { startJobRunner } = await import('./userApps/jobRunner.js');
  startJobRunner();

  ready = true;
  console.log('[VisionOS] Backend initialized');
  console.log(`[VisionOS] Database: ${config.dbPath}`);
  console.log(`[VisionOS] Workspace: ${config.workspaceDir}`);
}
