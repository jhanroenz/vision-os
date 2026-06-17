#!/usr/bin/env node
/** Stream SearXNG Docker logs (cross-platform). */
import { repoRoot, runCompose } from './lib.mjs';

try {
  runCompose(['logs', '-f'], { root: repoRoot() });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
