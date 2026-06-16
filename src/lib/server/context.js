import { config } from "./config.js";
import { minifyTranscript } from "./minify.js";
import { createChatCompletion, getActiveSlotId } from "./slots.js";

const tokenCache = new Map();

export async function countTokens(text) {
  if (!text) return 0;

  const cacheKey = text.slice(0, 200) + text.length;
  if (tokenCache.has(cacheKey)) return tokenCache.get(cacheKey);

  const base = config.llm.baseURL.replace(/\/v1$/, "");

  try {
    const response = await fetch(`${base}/tokenize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json();
      const count = data.tokens?.length ?? 0;
      tokenCache.set(cacheKey, count);
      return count;
    }
  } catch {
    // fall through to estimate
  }

  const estimate = Math.ceil(text.length / 3.5);
  tokenCache.set(cacheKey, estimate);
  return estimate;
}

function messageToText(message) {
  if (!message?.content) return "";
  return typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);
}

export async function countMessagesTokens(messages) {
  let total = 0;

  for (const message of messages) {
    const rolePrefix = `${message.role}: `;
    total += await countTokens(rolePrefix + messageToText(message));
    if (message.tool_calls?.length) {
      total += await countTokens(JSON.stringify(message.tool_calls));
    }
  }

  return total;
}

export function getContextStats(usedTokens) {
  const limit = config.llm.context;
  const reserved = config.llm.contextReserve;
  const usable = Math.max(limit - reserved, 0);
  const remaining = Math.max(usable - usedTokens, 0);
  const percent = usable > 0 ? Math.min((usedTokens / usable) * 100, 100) : 100;

  return {
    limit,
    reserved,
    used: usedTokens,
    remaining,
    percent: Math.round(percent * 10) / 10,
  };
}

export async function getConversationContext(messages) {
  const used = await countMessagesTokens(messages);
  return getContextStats(used);
}

export async function compactMessages(messages, { keepRecent = 8 } = {}) {
  if (messages.length <= keepRecent + 2) {
    return { messages, summary: null, compacted: false };
  }

  const system = messages[0];
  const recent = messages.slice(-keepRecent);
  const toCompress = messages.slice(1, -keepRecent);

  if (toCompress.length === 0) {
    return { messages, summary: null, compacted: false };
  }

  const transcript = minifyTranscript(toCompress)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const response = await createChatCompletion(
    [
      {
        role: "system",
        content:
          "You compress conversation history for Jarvis, Master Jan's local AI assistant. " +
          "Preserve: user goals, decisions, file paths, commands run, tool results, " +
          "errors, and unfinished tasks. Write a dense bullet-point summary. No preamble.",
      },
      {
        role: "user",
        content: `Summarize this conversation history:\n\n${transcript}`,
      },
    ],
    {
      slotId: getActiveSlotId(),
      temperature: 0.1,
      maxTokens: 2048,
      cachePrompt: false,
    },
  );

  const summary = response.choices[0]?.message?.content?.trim();
  if (!summary) {
    throw new Error("Compaction failed: empty summary from model");
  }

  const compacted = [
    system,
    {
      role: "user",
      content: `[Compacted conversation summary]\n${summary}`,
    },
    {
      role: "assistant",
      content:
        "Understood. I have the summarized context from our earlier conversation and will continue from here.",
    },
    ...recent,
  ];

  return { messages: compacted, summary, compacted: true };
}
