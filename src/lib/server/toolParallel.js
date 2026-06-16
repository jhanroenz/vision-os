import { randomUUID } from "node:crypto";
import { parseReactToolCall, unwrapNestedToolRequest } from "./toolArgs.js";
import { parseToolCallsFromContent } from "./toolParser.js";
import { READ_ONLY_ANSWER_TOOLS } from "./turnIntent.js";

/** Tools safe to run concurrently within one agent step. */
export const PARALLEL_SAFE_TOOLS = new Set(READ_ONLY_ANSWER_TOOLS);

/**
 * @param {import("openai").ChatCompletionMessage} assistantMessage
 * @param {Set<string>} knownToolNames
 * @returns {{ name: string, args: Record<string, unknown>, id?: string, native?: boolean }[]}
 */
export function extractToolRequests(assistantMessage, knownToolNames) {
  const requests = [];

  if (assistantMessage?.tool_calls?.length) {
    for (const call of assistantMessage.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      requests.push({
        name: call.function.name,
        args,
        id: call.id,
        native: true,
      });
    }
    return requests.map((req) => unwrapNestedToolRequest(req));
  }

  const react = parseReactToolCall(assistantMessage?.content);
  if (react) {
    return [unwrapNestedToolRequest(react)];
  }

  const parsed = parseToolCallsFromContent(
    assistantMessage?.content,
    knownToolNames,
  );
  for (const call of parsed) {
    let args = {};
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      args = {};
    }
    requests.push({
      name: call.function.name,
      args,
      id: call.id ?? `parsed_${randomUUID()}`,
      native: Boolean(call.id),
    });
  }

  return requests.map((req) => unwrapNestedToolRequest(req));
}

export function isParallelSafeTool(name) {
  return PARALLEL_SAFE_TOOLS.has(name);
}

/**
 * @param {{ name: string, args: Record<string, unknown>, id?: string, native?: boolean }[]} requests
 * @returns {Array<{ type: "parallel" | "sequential", requests: typeof requests }>}
 */
export function groupToolRequests(requests) {
  /** @type {Array<{ type: "parallel" | "sequential", requests: typeof requests }>} */
  const groups = [];

  for (const request of requests) {
    const parallel = isParallelSafeTool(request.name);
    const last = groups.at(-1);

    if (parallel && last?.type === "parallel") {
      last.requests.push(request);
    } else if (parallel) {
      groups.push({ type: "parallel", requests: [request] });
    } else {
      groups.push({ type: "sequential", requests: [request] });
    }
  }

  return groups;
}

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 */
export async function mapWithConcurrency(items, limit, fn) {
  if (!items.length) return [];
  const cap = Math.max(1, limit);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(cap, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
