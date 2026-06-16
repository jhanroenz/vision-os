import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

/** @type {Map<string, { turnId: string, seq: number, startedAt: string }>} */
const activeTurns = new Map();

/** @type {Map<string, Promise<void>>} */
const writeChains = new Map();

function sanitizeConversationId(conversationId) {
  return String(conversationId ?? "default").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function conversationDir(conversationId) {
  return path.join(config.transcript.dir, sanitizeConversationId(conversationId));
}

function turnFileName(startedAt, turnId) {
  const stamp = startedAt.replace(/[:.]/g, "-");
  return `${stamp}_${turnId.slice(0, 8)}.jsonl`;
}

function truncateValue(value, depth = 0) {
  const max = config.transcript.maxFieldChars;
  if (max <= 0 || value == null) return value;
  if (depth > 8) return "[max depth]";
  if (typeof value === "string") {
    return value.length > max ? `${value.slice(0, max)}…[+${value.length - max} chars]` : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => truncateValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = truncateValue(val, depth + 1);
    }
    return out;
  }
  return value;
}

function enqueueWrite(conversationId, fn) {
  const prev = writeChains.get(conversationId) ?? Promise.resolve();
  const next = prev.then(fn).catch((err) => {
    console.error("[transcript] write failed:", err.message);
  });
  writeChains.set(conversationId, next);
}

async function appendLine(filePath, line) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, line, "utf-8");
}

async function appendRecord(conversationId, type, data) {
  const state = activeTurns.get(conversationId);
  const seq = state ? ++state.seq : null;
  const record = {
    ts: new Date().toISOString(),
    conversationId,
    turnId: state?.turnId ?? null,
    seq,
    type,
    data: truncateValue(data),
  };

  const line = `${JSON.stringify(record)}\n`;
  const dir = conversationDir(conversationId);
  await appendLine(path.join(dir, "transcript.jsonl"), line);

  if (state?.turnId) {
    await appendLine(
      path.join(dir, "turns", turnFileName(state.startedAt, state.turnId)),
      line,
    );
  }
}

export function isTranscriptEnabled() {
  return config.transcript.enabled;
}

export function beginTurn(conversationId, meta = {}) {
  if (!config.transcript.enabled) return null;

  const turnId = randomUUID();
  const startedAt = new Date().toISOString();
  activeTurns.set(conversationId, { turnId, seq: 0, startedAt });

  record(conversationId, "turn_start", {
    turnId,
    startedAt,
    ...meta,
  });

  return turnId;
}

export function record(conversationId, type, data = {}) {
  if (!config.transcript.enabled) return;
  enqueueWrite(conversationId, () => appendRecord(conversationId, type, data));
}

export function recordEvent(conversationId, event) {
  if (!config.transcript.enabled || event == null) return;
  record(conversationId, event.type ?? "event", event);
}

export function endTurn(conversationId, meta = {}) {
  if (!config.transcript.enabled) return;

  const state = activeTurns.get(conversationId);
  record(conversationId, "turn_end", {
    turnId: state?.turnId ?? null,
    ...meta,
  });
  activeTurns.delete(conversationId);
}

export async function deleteTranscript(conversationId) {
  const dir = conversationDir(conversationId);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* missing */
  }
  writeChains.delete(conversationId);
  activeTurns.delete(conversationId);
}

async function readJsonlTail(filePath, tail = 500) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    const slice = tail > 0 ? lines.slice(-tail) : lines;
    const entries = [];
    for (const line of slice) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        entries.push({ type: "parse_error", raw: line.slice(0, 200) });
      }
    }
    return { totalLines: lines.length, entries };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { totalLines: 0, entries: [] };
    }
    throw err;
  }
}

export async function getTranscriptMeta(conversationId) {
  const dir = conversationDir(conversationId);
  const mainPath = path.join(dir, "transcript.jsonl");
  let totalLines = 0;
  let bytes = 0;
  let mtime = null;

  try {
    const stat = await fs.stat(mainPath);
    bytes = stat.size;
    mtime = stat.mtime.toISOString();
    const raw = await fs.readFile(mainPath, "utf-8");
    totalLines = raw.split("\n").filter(Boolean).length;
  } catch {
    /* no transcript yet */
  }

  let turns = [];
  try {
    const turnFiles = await fs.readdir(path.join(dir, "turns"));
    turns = turnFiles.filter((f) => f.endsWith(".jsonl")).sort().reverse();
  } catch {
    /* no turns dir */
  }

  return {
    conversationId,
    enabled: config.transcript.enabled,
    path: mainPath,
    totalLines,
    bytes,
    updatedAt: mtime,
    turnFiles: turns,
    activeTurn: activeTurns.get(conversationId) ?? null,
  };
}

export async function readTranscript(conversationId, { tail = 500, turnFile } = {}) {
  const dir = conversationDir(conversationId);
  const filePath = turnFile
    ? path.join(dir, "turns", path.basename(turnFile))
    : path.join(dir, "transcript.jsonl");

  const { totalLines, entries } = await readJsonlTail(filePath, tail);
  return {
    conversationId,
    filePath,
    totalLines,
    tail,
    entries,
  };
}
