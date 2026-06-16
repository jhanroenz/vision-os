import { AsyncLocalStorage } from "node:async_hooks";

const agentThreadAls = new AsyncLocalStorage();
/** @type {Map<string, (event: object) => void>} */
const streamEmitters = new Map();

export function registerRateLimitStreamEmitter(threadId, emit) {
  streamEmitters.set(String(threadId), emit);
}

export function unregisterRateLimitStreamEmitter(threadId) {
  streamEmitters.delete(String(threadId));
}

export async function runWithAgentThread(threadId, fn) {
  return agentThreadAls.run({ threadId: String(threadId) }, fn);
}

export function getAgentThreadId() {
  return agentThreadAls.getStore()?.threadId ?? null;
}

export function emitRateLimitStreamEvent(event) {
  const threadId = getAgentThreadId();
  if (!threadId) return;
  const emit = streamEmitters.get(threadId);
  if (!emit) return;
  try {
    emit(event);
  } catch (error) {
    console.warn("[rate-limit-notify] stream emit failed:", error.message);
  }
}
