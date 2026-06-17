#!/usr/bin/env node
/** Cross-platform SearXNG startup (Docker or bundled Python). */
import { ensureSearxng, repoRoot } from './lib.mjs';

const root = repoRoot();

try {
  await ensureSearxng({ root });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
