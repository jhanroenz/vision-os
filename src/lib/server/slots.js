import { config } from "./config.js";
import {
  getLlmAuthHeadersForRequest,
  getActiveProviderId,
  isCursorProvider,
  shouldUseLlmSlots,
} from "./llmProviders.js";
import {
  completionToStreamEvents,
  parseOpenAiSseStream,
  streamChatCompletionChunks,
} from "./llmStream.js";
import { fetchLlmWithRateLimit } from "./llmRateLimit.js";
import { createCursorChatCompletion } from "./cursorCompletion.js";
let activeConversationId = null;

export function getActiveConversationId() {
  return activeConversationId;
}

export function getActiveSlotId() {
  return config.llm.slotId;
}

export async function createChatCompletion(
  messages,
  {
    slotId = config.llm.slotId,
    maxTokens = 4096,
    temperature = config.llm.temperature,
    cachePrompt = true,
  } = {},
) {
  if (isCursorProvider()) {
    return createCursorChatCompletion(messages);
  }

  const headers = getLlmAuthHeadersForRequest();
  if (!headers.Authorization) {
    const provider = getActiveProviderId();
    throw new Error(
      `No API key configured for ${provider}. ` +
        (provider === "openrouter"
          ? "Paste an sk-or-v1- key in Settings or set OPENROUTER_API_KEY in .env."
          : "Set the provider API key in Settings or .env."),
    );
  }

  const response = await fetchLlmWithRateLimit(
    `${config.llm.baseURL}/chat/completions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.llm.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(shouldUseLlmSlots()
          ? { id_slot: slotId, cache_prompt: cachePrompt }
          : {}),
      }),
      signal: AbortSignal.timeout(600000),
    },
    { providerId: getActiveProviderId(), model: config.llm.model },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  return response.json();
}

function buildCompletionBody(messages, { slotId, maxTokens, temperature, cachePrompt, stream }) {
  return {
    model: config.llm.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream,
    ...(shouldUseLlmSlots()
      ? { id_slot: slotId, cache_prompt: cachePrompt }
      : {}),
  };
}

/**
 * Stream chat completion tokens. Yields delta events then a final done event.
 * Falls back to a single-chunk non-streaming response when streaming is disabled
 * or the provider returns JSON instead of SSE.
 */
export async function* streamChatCompletion(
  messages,
  {
    slotId = config.llm.slotId,
    maxTokens = 4096,
    temperature = config.llm.temperature,
    cachePrompt = true,
  } = {},
) {
  if (isCursorProvider()) {
    const response = await createCursorChatCompletion(messages);
    for (const event of completionToStreamEvents(response)) {
      yield event;
    }
    return;
  }

  if (!config.llm.streaming) {
    const response = await createChatCompletion(messages, {
      slotId,
      maxTokens,
      temperature,
      cachePrompt,
    });
    for (const event of completionToStreamEvents(response)) {
      yield event;
    }
    return;
  }

  const headers = getLlmAuthHeadersForRequest();
  if (!headers.Authorization) {
    const provider = getActiveProviderId();
    throw new Error(
      `No API key configured for ${provider}. ` +
        (provider === "openrouter"
          ? "Paste an sk-or-v1- key in Settings or set OPENROUTER_API_KEY in .env."
          : "Set the provider API key in Settings or .env."),
    );
  }

  const response = await fetchLlmWithRateLimit(
    `${config.llm.baseURL}/chat/completions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(
        buildCompletionBody(messages, {
          slotId,
          maxTokens,
          temperature,
          cachePrompt,
          stream: true,
        }),
      ),
      signal: AbortSignal.timeout(600000),
    },
    { providerId: getActiveProviderId(), model: config.llm.model },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (
    !response.body ||
    (!contentType.includes("text/event-stream") &&
      !contentType.includes("application/x-ndjson"))
  ) {
    const json = await response.json();
    for (const event of completionToStreamEvents(json)) {
      yield event;
    }
    return;
  }

  yield* streamChatCompletionChunks(parseOpenAiSseStream(response.body));
}

export async function activateConversation(conversationId) {
  if (!shouldUseLlmSlots()) {
    activeConversationId = conversationId;
    return { activated: true, switched: false, slotsEnabled: false };
  }

  if (activeConversationId === conversationId) {
    return { activated: true, switched: false, slotId: config.llm.slotId };
  }

  const previousId = activeConversationId;
  activeConversationId = conversationId;

  return {
    activated: true,
    switched: true,
    previousId,
    slotId: config.llm.slotId,
  };
}

export function clearActiveConversation() {
  activeConversationId = null;
}
