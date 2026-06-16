import { runAgent, streamAgent } from '../agent.js';
import { normalizeComposerMode } from '../composerMode.js';
import {
  registerRateLimitStreamEmitter,
  unregisterRateLimitStreamEmitter,
  runWithAgentThread
} from '../rateLimitNotify.js';
import { json, jsonError, readJson, sse } from '../http.js';

export async function postChat(request: Request) {
  const { message, threadId, mode } = await readJson(request);

  if (!message?.trim()) {
    return jsonError('message is required', 400);
  }

  try {
    const result = await runAgent({
      message,
      threadId,
      mode: normalizeComposerMode(mode)
    });
    return json(result);
  } catch (error) {
    console.error('Agent error:', error);
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function postChatStream(request: Request) {
  const { message, threadId, mode } = await readJson(request);

  if (!message?.trim()) {
    return jsonError('message is required', 400);
  }

  const streamThreadId = threadId ?? 'default';

  return sse(async (send) => {
    registerRateLimitStreamEmitter(streamThreadId, send);
    try {
      await runWithAgentThread(streamThreadId, async () => {
        for await (const event of streamAgent({
          message,
          threadId,
          mode: normalizeComposerMode(mode)
        })) {
          if (event == null) continue;
          send(event);
        }
      });
    } finally {
      unregisterRateLimitStreamEmitter(streamThreadId);
    }
  });
}
