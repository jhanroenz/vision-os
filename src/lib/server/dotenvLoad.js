import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { isPackaged, resolveDataDir, resolveVisionRoot } from './paths.js';

/**
 * Load optional `.env` files. Packaged builds only read the user data directory
 * so install-time / resource-tree secrets are never applied.
 */
export function loadVisionEnv() {
  const dataDir = resolveDataDir();
  const dataEnv = path.join(dataDir, '.env');
  if (fs.existsSync(dataEnv)) {
    dotenv.config({ path: dataEnv });
  }

  if (!isPackaged()) {
    const rootEnv = path.join(resolveVisionRoot(), '.env');
    if (fs.existsSync(rootEnv)) {
      dotenv.config({ path: rootEnv });
    }
  }
}
