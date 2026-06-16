import { randomUUID } from "node:crypto";

export function createSessionMemory(sessionId) {
  return {
    sessionId,
    queriesExecuted: new Set(),
    urlsSeen: new Set(),
    domainsSeen: new Map(),
    sources: [],
    claims: [],
    contradictions: [],
    media: [],
    searchesPerformed: 0,
    pagesFetched: 0,
    /** @type {string[]} engines queried this session (for rotation) */
    enginesUsed: [],
  };
}

export function normalizeUrl(url) {
  try {
    const parsed = new URL(String(url ?? "").trim());
    parsed.hash = "";
    let path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return String(url ?? "").trim().toLowerCase();
  }
}

export function normalizeQuery(query) {
  return String(query ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function hasQueryExecuted(memory, query) {
  return memory.queriesExecuted.has(normalizeQuery(query));
}

export function markQueryExecuted(memory, query) {
  memory.queriesExecuted.add(normalizeQuery(query));
  memory.searchesPerformed += 1;
}

export function hasUrlSeen(memory, url) {
  return memory.urlsSeen.has(normalizeUrl(url));
}

export function markUrlSeen(memory, url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return;
  memory.urlsSeen.add(normalized);
  const domain = domainFromUrl(url);
  if (domain) {
    memory.domainsSeen.set(domain, (memory.domainsSeen.get(domain) ?? 0) + 1);
  }
}

export function newId(prefix = "id") {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
