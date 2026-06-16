import { normalizeAssistantMessage, createThoughtTagStreamSplitter, feedThoughtTagStream, flushThoughtTagStream } from "./reasoning.js";

/** @param {ReadableStream<Uint8Array>} body */
export async function* parseOpenAiSseStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (trimmed === "data: [DONE]") return;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          yield JSON.parse(trimmed.slice(6));
        } catch {
          // skip malformed chunk
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function mergeToolCallDelta(toolCalls, deltaCalls) {
  if (!deltaCalls?.length) return;

  for (const delta of deltaCalls) {
    const index = delta.index ?? 0;
    if (!toolCalls[index]) {
      toolCalls[index] = {
        id: delta.id ?? "",
        type: delta.type ?? "function",
        function: { name: "", arguments: "" },
      };
    }

    const target = toolCalls[index];
    if (delta.id) target.id = delta.id;
    if (delta.type) target.type = delta.type;
    if (delta.function?.name) {
      target.function.name += delta.function.name;
    }
    if (delta.function?.arguments) {
      target.function.arguments += delta.function.arguments;
    }
  }
}

/**
 * Stream an OpenAI-compatible chat completion.
 * Yields { type: "delta", field, text } then { type: "done", message, reasoning, usage }.
 */
export async function* streamChatCompletionChunks(chunks) {
  let content = "";
  let reasoningContent = "";
  const toolCalls = [];
  let usage = {};
  const thoughtStream = createThoughtTagStreamSplitter();

  for await (const chunk of chunks) {
    if (chunk?.usage) usage = chunk.usage;

    const choice = chunk?.choices?.[0];
    const delta = choice?.delta;
    if (!delta) continue;

    if (delta.content) {
      const split = feedThoughtTagStream(thoughtStream, delta.content);
      if (split.reasoning) {
        reasoningContent += split.reasoning;
        yield { type: "delta", field: "reasoning", text: split.reasoning };
      }
      if (split.content) {
        content += split.content;
        yield { type: "delta", field: "content", text: split.content };
      }
    }

    const reasoning =
      delta.reasoning_content ??
      delta.reasoning ??
      null;
    if (reasoning) {
      reasoningContent += reasoning;
      yield { type: "delta", field: "reasoning", text: reasoning };
    }

    mergeToolCallDelta(toolCalls, delta.tool_calls);

    if (choice?.finish_reason === "tool_calls" || choice?.finish_reason === "stop") {
      // final chunk may carry finish_reason; keep accumulating
    }
  }

  const tail = flushThoughtTagStream(thoughtStream);
  if (tail.reasoning) {
    reasoningContent += tail.reasoning;
    yield { type: "delta", field: "reasoning", text: tail.reasoning };
  }
  if (tail.content) {
    content += tail.content;
    yield { type: "delta", field: "content", text: tail.content };
  }

  const raw = {
    role: "assistant",
    content,
    ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
    ...(toolCalls.length
      ? { tool_calls: toolCalls.filter(Boolean) }
      : {}),
  };

  const message = normalizeAssistantMessage(raw);

  yield {
    type: "done",
    message,
    reasoning: message.reasoning_content ?? "",
    usage,
  };
}

/** Non-streaming response → same event shape as a one-shot stream. */
export function completionToStreamEvents(response) {
  const raw = response?.choices?.[0]?.message ?? {
    role: "assistant",
    content: "",
  };
  const message = normalizeAssistantMessage(raw);
  const content = message.content ?? "";

  return [
    ...(content ? [{ type: "delta", field: "content", text: content }] : []),
    ...(message.reasoning_content
      ? [{ type: "delta", field: "reasoning", text: message.reasoning_content }]
      : []),
    {
      type: "done",
      message,
      reasoning: message.reasoning_content ?? "",
      usage: response?.usage ?? {},
    },
  ];
}
