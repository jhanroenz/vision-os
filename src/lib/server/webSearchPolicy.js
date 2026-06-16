import { config } from "./config.js";

/** @typedef {{ count: number, queries: Map<string, string>, enginesUsed: string[] }} TurnState */

const turnState = new Map();

function normalizeQuery(query) {
  return String(query ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function beginWebSearchTurn(threadId) {
  turnState.set(threadId, { count: 0, queries: new Map(), enginesUsed: [] });
}

function getTurn(threadId) {
  return turnState.get(threadId) ?? null;
}

/**
 * Reserve a search slot (counts toward per-turn limit even if the request fails).
 * @returns {{ allowed: boolean, cached?: string, message?: string }}
 */
export async function reserveWebSearch(threadId, query, { userMessage } = {}) {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return { allowed: false, message: "Web search query cannot be empty." };
  }

  const { resolveBrainInsteadOfSearch } = await import("./webSearchMemory.js");
  const brain = await resolveBrainInsteadOfSearch(threadId, query, userMessage);
  if (brain) {
    return {
      allowed: false,
      cached: brain.formatted,
      fromBrain: true,
    };
  }

  const turn = getTurn(threadId);
  if (!turn) {
    return { allowed: true };
  }

  const cached = turn.queries.get(normalized);
  if (cached !== undefined) {
    return {
      allowed: false,
      cached:
        `[Cached — same query already searched this turn. One search per turn — use these results or your training knowledge, then inspect_codebase and update_task_plan.]\n` +
        (cached || "No stored results for this query."),
    };
  }

  const max = config.searxng.maxPerTurn;
  if (turn.count >= max) {
    return {
      allowed: false,
      message:
        `Web search limit reached (${max} per turn). ` +
        "Do not search again — use your earlier results or your built-in training knowledge and proceed with the task.",
    };
  }

  turn.count += 1;
  turn.queries.set(normalized, "");
  return { allowed: true };
}

export function completeWebSearch(threadId, query, result, { engines } = {}) {
  const turn = getTurn(threadId);
  if (!turn) return;

  const normalized = normalizeQuery(query);
  if (normalized && turn.queries.has(normalized)) {
    turn.queries.set(normalized, result);
  }

  if (engines) {
    for (const name of String(engines).split(",")) {
      const engine = name.trim().toLowerCase();
      if (engine && !turn.enginesUsed.includes(engine)) {
        turn.enginesUsed.push(engine);
      }
    }
  }
}

export function webSearchCountThisTurn(threadId) {
  return getTurn(threadId)?.count ?? 0;
}

/** @returns {string[]} */
export function getEnginesUsedThisTurn(threadId) {
  return getTurn(threadId)?.enginesUsed ?? [];
}
