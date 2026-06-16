import { config } from "./config.js";
import {
  compactConversation,
  getConversation,
  resolveLlmMessages,
} from "./conversations.js";
import { getConversationContext, countMessagesTokens } from "./context.js";
import { resolveLlmRateLimits } from "./llmRateLimit.js";
import { getActiveProviderId } from "./llmProviders.js";
import { TURN_PACKET_PREFIX } from "./briefLifecycle.js";
import { shrinkTurnPacketContent } from "./turnPacket.js";

/**
 * Pre-turn context budget: compact transcript and shrink turn packet if needed.
 */
export async function ensureContextBudget(conversationId) {
  const conversation = await getConversation(conversationId);
  if (!conversation) return { ok: true };

  let messages = await resolveLlmMessages(conversation);
  let context = await getConversationContext(messages);

  const threshold = config.llm.autoCompactPercent ?? 60;
  if (context.percent >= threshold) {
    await compactConversation(conversationId, {
      auto: true,
      percent: context.percent,
    });
    const refreshed = await getConversation(conversationId);
    messages = await resolveLlmMessages(refreshed);
    context = await getConversationContext(messages);
  }

  const providerId = getActiveProviderId();
  const limits = resolveLlmRateLimits(providerId, config.llm.model);
  if (!limits.tpm) {
    return { ok: true, context };
  }

  let tokens = await countMessagesTokens(messages);
  if (tokens <= limits.tpm) {
    return { ok: true, context, tokens };
  }

  const shrunk = shrinkTurnPacketInConversation(conversation);
  if (shrunk) {
    await compactConversation(conversationId, { auto: true, percent: 100 });
    const refreshed = await getConversation(conversationId);
    messages = await resolveLlmMessages(refreshed);
    tokens = await countMessagesTokens(messages);
    context = await getConversationContext(messages);
  }

  if (tokens > limits.tpm) {
    return {
      ok: false,
      context,
      tokens,
      tpm: limits.tpm,
      error: `Context ${tokens} tokens exceeds provider TPM cap ${limits.tpm}. Compact the conversation or raise TPM in Settings.`,
    };
  }

  return { ok: true, context, tokens };
}

function shrinkTurnPacketInConversation(conversation) {
  if (!conversation?.llmMessages) return false;
  let changed = false;

  for (const message of conversation.llmMessages) {
    const content = String(message.content ?? "");
    if (
      message.meta?.kind === "turn_packet" ||
      content.startsWith(TURN_PACKET_PREFIX)
    ) {
      const next = shrinkTurnPacketContent(content, { dropFiles: true });
      if (next !== content) {
        message.content = next;
        changed = true;
      }
    }
  }

  if (changed) {
    const packetIdx = conversation.llmMessages.findIndex(
      (m) =>
        m.meta?.kind === "turn_packet" ||
        String(m.content ?? "").startsWith(TURN_PACKET_PREFIX),
    );
    if (packetIdx >= 0) {
      const [packet] = conversation.llmMessages.splice(packetIdx, 1);
      conversation.llmMessages.push(packet);
    }
  }

  return changed;
}
