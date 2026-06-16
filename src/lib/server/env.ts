import path from 'node:path';
import { loadVisionEnv } from './dotenvLoad.js';
import { resolveDataDir, resolveVisionRoot } from './paths.js';

loadVisionEnv();

const visionRoot = resolveVisionRoot();
const dataDir = resolveDataDir();

export { visionRoot, dataDir };
