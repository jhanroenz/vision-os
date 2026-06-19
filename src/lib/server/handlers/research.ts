import {
  getResearchSession,
  listResearchSessions,
  deleteResearchSession,
  updateResearchSessionTitle
} from '../deepResearch/repository.js';
import {
  registerRateLimitStreamEmitter,
  unregisterRateLimitStreamEmitter,
  runWithAgentThread
} from '../rateLimitNotify.js';
import { json, jsonError, readJson, sse } from '../http.js';

export function list() {
  try {
    return json({ sessions: listResearchSessions() });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export function get(sessionId: string) {
  try {
    const session = getResearchSession(sessionId);
    if (!session) {
      return jsonError('Research session not found', 404);
    }
    return json(session);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function patch(sessionId: string, request: Request) {
  try {
    const session = getResearchSession(sessionId);
    if (!session) {
      return jsonError('Research session not found', 404);
    }
    const { title } = await readJson(request);
    const updated = updateResearchSessionTitle(sessionId, title);
    return json(updated);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export function remove(sessionId: string) {
  try {
    const session = getResearchSession(sessionId);
    if (!session) {
      return jsonError('Research session not found', 404);
    }
    deleteResearchSession(sessionId);
    return json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function stream(request: Request) {
  const { message, tier } = await readJson(request);

  if (!message?.trim()) {
    return jsonError('message is required', 400);
  }

  const streamThreadId = 'research:live';

  return sse(async (send) => {
    const { streamDeepResearch } = await import('../deepResearch/orchestrator.js');
    registerRateLimitStreamEmitter(streamThreadId, send);
    try {
      await runWithAgentThread(streamThreadId, async () => {
        for await (const event of streamDeepResearch({ message, tier })) {
          if (event == null) continue;
          send(event);
        }
      });
    } finally {
      unregisterRateLimitStreamEmitter(streamThreadId);
    }
  });
}
