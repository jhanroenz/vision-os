import { initDatabase } from './db.js';
import { initSettings } from './settings.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { dataDir, visionRoot } from './env';
import { isPackaged } from './paths.js';

let ready = false;

async function ensureRuntimeDirs() {
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

  const script = path.join(visionRoot, 'searxng', 'ensure.sh');
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

  await ensureRuntimeDirs();

  ensureSearxngOnStartup();

  ready = true;
  console.log('[VisionOS] Backend initialized');
  console.log(`[VisionOS] Database: ${config.dbPath}`);
  console.log(`[VisionOS] Workspace: ${config.workspaceDir}`);
}
