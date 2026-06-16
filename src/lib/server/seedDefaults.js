import path from 'node:path';
import { defaultWorkspaceDir, isPackaged, resolveDataDir } from './paths.js';
import { packagedSearxngBase } from './ports.js';
import { getCodeDefaultsBySection } from './settingsRegistry.js';

/** Defaults seeded into SQLite on first run (packaged-aware). */
export function getSeedDefaults() {
  const defaults = getCodeDefaultsBySection();

  if (!isPackaged()) {
    return defaults;
  }

  defaults.search.searxngApiBase = packagedSearxngBase();
  defaults.workspace.workspaceDir = process.env.WORKSPACE_DIR
    ? path.resolve(process.env.WORKSPACE_DIR)
    : defaultWorkspaceDir(resolveDataDir());

  return defaults;
}
