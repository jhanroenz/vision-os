import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRetriv } from "retriv";
import { autoChunker } from "retriv/chunkers/auto";
import sqlite from "retriv/db/sqlite";
import { transformersJs } from "retriv/embeddings/transformers-js";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { memoryMatchesProjectScope, normalizeBrainProject } from "./brainProject.js";

let searchInstance = null;
let initPromise = null;

function indexDir() {
  return path.join(config.workspaceDir, ".jarvis");
}

function dbPath() {
  return path.join(indexDir(), "brain-semantic-index.db");
}

function manifestPath() {
  return path.join(indexDir(), "brain-index-manifest.json");
}

function brainIndexFingerprint() {
  const memories = getDb()
    .prepare(`SELECT id, updated_at, project FROM core_memories WHERE enabled = 1`)
    .all();
  const skills = getDb()
    .prepare(`SELECT id, updated_at, project FROM skills WHERE enabled = 1`)
    .all();
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ memories, skills }))
    .digest("hex");
}

async function loadManifest() {
  try {
    const raw = await fs.readFile(manifestPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveManifest(fingerprint) {
  await fs.mkdir(indexDir(), { recursive: true });
  await fs.writeFile(
    manifestPath(),
    `${JSON.stringify(
      {
        version: 1,
        fingerprint,
        syncedAt: new Date().toISOString(),
        model: config.evolution.brainSemantic.model,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

export async function ensureBrainIndexFresh() {
  if (!config.evolution.brainSemantic.enabled) return { synced: false, disabled: true };

  const fingerprint = brainIndexFingerprint();
  const manifest = await loadManifest();
  if (manifest?.fingerprint === fingerprint) {
    return { synced: false, unchanged: true };
  }

  const stats = await syncBrainIndexFromDb();
  await saveManifest(fingerprint);
  return { synced: true, ...stats };
}

function memoryDocId(id) {
  return `memory:${id}`;
}

function skillDocId(id) {
  return `skill:${id}`;
}

function memoryToDoc(row) {
  const body = [row.title, row.content, row.prompt_text, row.category, row.project]
    .filter(Boolean)
    .join("\n");
  return {
    id: memoryDocId(row.id),
    content: body,
    metadata: {
      brainType: "memory",
      itemId: row.id,
      title: row.title,
      category: row.category ?? null,
      importance: row.importance ?? 3,
      project: row.project ?? null,
    },
  };
}

function skillToDoc(row) {
  const body = [row.name, row.description, row.instructions, row.prompt_text, row.project]
    .filter(Boolean)
    .join("\n");
  return {
    id: skillDocId(row.id),
    content: body,
    metadata: {
      brainType: "skill",
      itemId: row.id,
      name: row.name,
      project: row.project ?? null,
    },
  };
}

async function getBrainSearch() {
  if (!config.evolution.brainSemantic.enabled) {
    throw new Error("Brain semantic search is disabled");
  }
  if (searchInstance) return searchInstance;
  if (!initPromise) {
    initPromise = (async () => {
      await fs.mkdir(indexDir(), { recursive: true });
      searchInstance = await createRetriv({
        driver: sqlite({
          path: dbPath(),
          embeddings: transformersJs({
            model: config.evolution.brainSemantic.model,
          }),
        }),
        chunking: autoChunker(),
        categories: (doc) => doc.metadata?.brainType ?? "other",
      });
      return searchInstance;
    })();
  }
  return initPromise;
}

export async function indexMemoryRow(row) {
  if (!config.evolution.brainSemantic.enabled || !row?.id) return;
  try {
    const search = await getBrainSearch();
    await search.index([memoryToDoc(row)]);
  } catch (error) {
    console.warn("Brain index memory failed:", error.message);
  }
}

export async function indexSkillRow(row) {
  if (!config.evolution.brainSemantic.enabled || !row?.id) return;
  try {
    const search = await getBrainSearch();
    await search.index([skillToDoc(row)]);
  } catch (error) {
    console.warn("Brain index skill failed:", error.message);
  }
}

export async function removeMemoryFromIndex(id) {
  if (!config.evolution.brainSemantic.enabled || !id) return;
  try {
    const search = await getBrainSearch();
    if (search.remove) await search.remove(memoryDocId(id));
  } catch (error) {
    console.warn("Brain remove memory failed:", error.message);
  }
}

export async function removeSkillFromIndex(id) {
  if (!config.evolution.brainSemantic.enabled || !id) return;
  try {
    const search = await getBrainSearch();
    if (search.remove) await search.remove(skillDocId(id));
  } catch (error) {
    console.warn("Brain remove skill failed:", error.message);
  }
}

/** Full sync from jarvis.db — safe for small brain sizes. */
export async function syncBrainIndexFromDb() {
  if (!config.evolution.brainSemantic.enabled) {
    return { indexed: 0, disabled: true };
  }

  const search = await getBrainSearch();
  const memories = getDb()
    .prepare(`SELECT * FROM core_memories WHERE enabled = 1`)
    .all();
  const skills = getDb().prepare(`SELECT * FROM skills WHERE enabled = 1`).all();

  const docs = [
    ...memories.map(memoryToDoc),
    ...skills.map(skillToDoc),
  ];

  if (!docs.length) {
    return { indexed: 0 };
  }

  const batchSize = 20;
  let indexed = 0;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    await search.index(batch);
    indexed += batch.length;
  }

  return { indexed };
}

/**
 * @returns {Promise<Array<{ itemId: string, brainType: 'memory'|'skill', score: number }>>}
 */
export async function searchBrainSemantic(
  query,
  { type = "both", limit = 8, project = null } = {},
) {
  if (!config.evolution.brainSemantic.enabled) return [];

  const q = String(query ?? "").trim();
  if (!q) return [];

  await ensureBrainIndexFresh();

  const search = await getBrainSearch();
  const maxResults = Math.min(Math.max(limit, 1), config.evolution.recallMaxResults);

  const filter =
    type === "memory"
      ? { brainType: "memory" }
      : type === "skill"
        ? { brainType: "skill" }
        : undefined;

  const results = await search.search(q, {
    limit: maxResults,
    returnContent: false,
    returnMetadata: true,
    filter,
  });

  const minScore = config.evolution.brainSemantic.minScore;
  const hits = [];

  for (const result of results) {
    const score = typeof result.score === "number" ? result.score : 0;
    if (score < minScore) continue;

    const meta = result.metadata ?? {};
    const brainType = meta.brainType;
    const itemId = meta.itemId;
    if (!itemId || (brainType !== "memory" && brainType !== "skill")) continue;
    if (!memoryMatchesProjectScope(meta.project, project)) continue;

    hits.push({
      itemId: String(itemId),
      brainType,
      score,
    });
  }

  return hits;
}
