const THINK_OPEN = "<" + "think" + ">";
const REDACTED_OPEN = "<" + "redacted_thinking" + ">";

const THINKING_TAG_PATTERNS = [
  new RegExp(`${THINK_OPEN}([\\s\\S]*?)<\\/think>`, "gi"),
  new RegExp(`${REDACTED_OPEN}([\\s\\S]*?)<\\/think>`, "gi"),
  /<thought>([\s\S]*?)<\/thought>/gi,
  /<thinking>([\s\S]*?)<\/thinking>/gi,
  new RegExp(`${REDACTED_OPEN}([\\s\\S]*?)<\\/redacted_thinking>`, "gi"),
];

/**
 * Extract model reasoning from an assistant message.
 * Supports llama.cpp `reasoning_content` and inline thinking tags in `content`.
 */
export function extractReasoning(message) {
  let reasoning = String(message?.reasoning_content ?? "").trim();
  let content = message?.content ?? "";

  if (!reasoning && typeof content === "string" && content) {
    const parts = [];
    for (const pattern of THINKING_TAG_PATTERNS) {
      content = content.replace(pattern, (_, inner) => {
        const trimmed = inner.trim();
        if (trimmed) parts.push(trimmed);
        return "";
      });
    }
    if (parts.length) {
      reasoning = parts.join("\n\n").trim();
      content = content.trim();
    }
  }

  return { reasoning, content };
}

export function normalizeAssistantMessage(message) {
  const { reasoning, content } = extractReasoning(message);
  return {
    ...message,
    content,
    ...(reasoning ? { reasoning_content: reasoning } : {}),
  };
}

/** Text from a non-streaming chat completion (handles thinking tags / reasoning_content). */
export function extractCompletionText(completion) {
  const message = completion?.choices?.[0]?.message;
  if (!message) return "";

  const normalized = normalizeAssistantMessage(message);
  const content = String(normalized.content ?? "").trim();
  if (content) return content;

  // Some thinking models emit only reasoning_content on short tasks.
  return String(normalized.reasoning_content ?? "").trim();
}

const THOUGHT_OPEN = "<thought>";
const THOUGHT_CLOSE = "</thought>";

/** Hold only when buffer ends with a prefix of an opening/closing thought tag. */
function suffixTagPrefixHold(buffer, tag) {
  const lower = String(buffer ?? "").toLowerCase();
  const open = String(tag ?? "").toLowerCase();
  let hold = 0;
  for (let i = 1; i < open.length; i++) {
    if (open.startsWith(lower.slice(-i))) hold = i;
  }
  return hold;
}

/** Incrementally split streamed text into visible content vs Gemma `<thought>` blocks. */
export function createThoughtTagStreamSplitter() {
  return { buffer: "", inTag: false };
}

export function feedThoughtTagStream(state, chunk) {
  state.buffer += chunk;
  const out = { content: "", reasoning: "" };

  while (state.buffer.length) {
    if (state.inTag) {
      const closeAt = state.buffer.toLowerCase().indexOf(THOUGHT_CLOSE);
      if (closeAt === -1) {
        const hold = suffixTagPrefixHold(state.buffer, THOUGHT_CLOSE);
        if (state.buffer.length > hold) {
          out.reasoning += state.buffer.slice(0, state.buffer.length - hold);
          state.buffer = state.buffer.slice(state.buffer.length - hold);
        }
        break;
      }
      out.reasoning += state.buffer.slice(0, closeAt);
      state.buffer = state.buffer.slice(closeAt + THOUGHT_CLOSE.length);
      state.inTag = false;
      continue;
    }

    const openAt = state.buffer.toLowerCase().indexOf(THOUGHT_OPEN);
    if (openAt === -1) {
      const hold = suffixTagPrefixHold(state.buffer, THOUGHT_OPEN);
      if (state.buffer.length > hold) {
        out.content += state.buffer.slice(0, state.buffer.length - hold);
        state.buffer = state.buffer.slice(state.buffer.length - hold);
      }
      break;
    }
    out.content += state.buffer.slice(0, openAt);
    state.buffer = state.buffer.slice(openAt + THOUGHT_OPEN.length);
    state.inTag = true;
  }

  return out;
}

export function flushThoughtTagStream(state) {
  const out = { content: "", reasoning: "" };
  if (!state.buffer) return out;
  if (state.inTag) out.reasoning = state.buffer;
  else out.content = state.buffer;
  state.buffer = "";
  state.inTag = false;
  return out;
}
