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

/** True for paths like `D:\`, `C:\`, or `/` that must not be used as workspace roots. */
export function isDriveOrFilesystemRoot(dir) {
  const resolved = path.resolve(String(dir ?? ''));
  const parsed = path.parse(resolved);
  if (parsed.root) {
    const normalized = resolved.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
    const root = parsed.root.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
    if (normalized === root) return true;
  }
  return resolved === '/';
}

/** Writable agent workspace — env override, else ~/VisionOS/workspace on all platforms. */
export function resolveWorkspaceDir(dataDir = resolveDataDir()) {
  if (process.env.WORKSPACE_DIR) {
    const fromEnv = path.resolve(process.env.WORKSPACE_DIR);
    if (!isDriveOrFilesystemRoot(fromEnv)) return fromEnv;
  }
  return defaultWorkspaceDir(dataDir);
}

export function isPackaged() {
  return process.env.VISIONOS_PACKAGED === 'true';
}
