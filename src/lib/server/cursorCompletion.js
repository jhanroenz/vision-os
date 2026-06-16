import { Agent } from "@cursor/sdk";
import { config } from "./config.js";
import { buildCursorModelSelection, resolveLlmApiKey } from "./llmProviders.js";

const AUX_MODE_PREFIX =
  "Read-only task: respond with text only. Do not create, edit, or delete files. " +
  "Do not run shell commands or use tools unless the prompt explicitly requires it.\n\n";

/**
 * Flatten OpenAI-style chat messages into a single Cursor prompt.
 * @param {Array<{ role: string, content: string }>} messages
 */
function formatMessagesAsPrompt(messages) {
  const parts = [];

  for (const msg of messages) {
    const role =
      msg.role === "system" ? "System" : msg.role === "assistant" ? "Assistant" : "User";
    const content =
      typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");

    if (role === "System") {
      parts.push(`System:\n${content}`);
    } else {
      parts.push(`\n\n${role}:\n${content}`);
    }
  }

  return parts.join("");
}

/** @param {string} text */
function toOpenAiCompletion(text) {
  return {
    id: "cursor-aux",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
  };
}

/**
 * One-shot auxiliary completion via Cursor SDK (research synthesis, compaction, etc.).
 * Returns an OpenAI-shaped response for extractCompletionText().
 *
 * @param {Array<{ role: string, content: string }>} messages
 */
export async function createCursorChatCompletion(messages) {
  const apiKey = resolveLlmApiKey("cursor");
  if (!apiKey) {
    throw new Error(
      "No Cursor API key configured. Paste your key in Settings or set CURSOR_API_KEY in .env.",
    );
  }

  const prompt = `${AUX_MODE_PREFIX}${formatMessagesAsPrompt(messages)}`;
  const modelSelection = buildCursorModelSelection();

  const runResult = await Agent.prompt(prompt, {
    apiKey,
    model: modelSelection,
    mode: "plan",
    local: {
      cwd: config.workspaceDir,
      sandboxOptions: { enabled: false },
    },
  });

  if (runResult.status === "error" || runResult.status === "cancelled") {
    throw new Error(runResult.result?.trim() || "Cursor auxiliary completion failed");
  }

  const text = runResult.result?.trim() ?? "";
  if (!text) {
    throw new Error("Cursor auxiliary completion returned empty response");
  }

  return toOpenAiCompletion(text);
}
