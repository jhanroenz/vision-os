import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Dev source tree root (src/lib/server → ../../..). */
function devSourceRoot() {
  return path.resolve(__dirname, '../../..');
}

/**
 * Install / resource root. Set by the Tauri shell when running packaged builds.
 * Contains `server/`, `node/`, `searxng/`, etc.
 */
export function resolveVisionRoot() {
  if (process.env.VISIONOS_ROOT) {
    return path.resolve(process.env.VISIONOS_ROOT);
  }
  return devSourceRoot();
}

/**
 * Writable user data directory (database, transcripts, HF cache, optional .env).
 */
export function resolveDataDir() {
  if (process.env.VISIONOS_DATA_DIR) {
    return path.resolve(process.env.VISIONOS_DATA_DIR);
  }
  const root = resolveVisionRoot();
  if (process.env.VISIONOS_PACKAGED === 'true') {
    return path.join(os.homedir(), '.local', 'share', 'visionos');
  }
  return path.join(root, 'data');
}

export function resolveServerRoot() {
  if (process.env.VISIONOS_SERVER_ROOT) {
    return path.resolve(process.env.VISIONOS_SERVER_ROOT);
  }
  const root = resolveVisionRoot();
  if (process.env.VISIONOS_PACKAGED === 'true') {
    return path.join(root, 'server');
  }
  return root;
}

export function defaultWorkspaceDir(dataDir) {
  return path.join(os.homedir(), 'VisionOS', 'workspace');
}

export function isPackaged() {
  return process.env.VISIONOS_PACKAGED === 'true';
}
