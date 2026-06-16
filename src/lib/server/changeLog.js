import { randomUUID } from "node:crypto";

const MAX_CHANGES_PER_THREAD = 50;
const store = new Map();

function getThreadChanges(threadId) {
  if (!store.has(threadId)) {
    store.set(threadId, []);
  }
  return store.get(threadId);
}

export function recordFileChange(threadId, change) {
  const entry = {
    id: change.id ?? randomUUID(),
    threadId,
    path: change.path,
    action: change.action,
    stats: change.stats,
    diff: change.diff ?? null,
    unified: change.unified ?? null,
    before: change.before ?? null,
    after: change.after ?? null,
    truncated: change.truncated ?? false,
    at: Date.now(),
  };

  const list = getThreadChanges(threadId);
  list.push(entry);
  if (list.length > MAX_CHANGES_PER_THREAD) {
    list.splice(0, list.length - MAX_CHANGES_PER_THREAD);
  }

  return entry;
}

export function getFileChange(threadId, changeId) {
  return getThreadChanges(threadId).find((c) => c.id === changeId) ?? null;
}

export function listFileChanges(threadId) {
  return [...getThreadChanges(threadId)];
}
