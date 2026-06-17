#!/usr/bin/env node
/** Restart dev SearXNG (Docker down + ensure). */
import { ensureSearxng, repoRoot, runCompose } from './lib.mjs';

const root = repoRoot();

try {
  try {
    runCompose(['down'], { root });
  } catch {
    // container may not exist yet
  }
  await ensureSearxng({ root });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
