import { config } from "./config.js";
import {
  compactConversation,
  getConversation,
  resolveLlmMessages,
} from "./conversations.js";
import { getConversationContext } from "./context.js";

export async function maybeAutoCompact(conversationId, { skip = false } = {}) {
  if (skip) return null;

  const conversation = await getConversation(conversationId);
  if (!conversation) return null;

  const messages = await resolveLlmMessages(conversation);
  const context = await getConversationContext(messages);

  if (context.percent < config.llm.autoCompactPercent) {
    return { compacted: false, context };
  }

  const result = await compactConversation(conversationId, {
    auto: true,
    percent: context.percent,
  });

  return {
    auto: true,
    compacted: result.compacted,
    context: result.context,
    summary: result.summary ?? null,
  };
}
