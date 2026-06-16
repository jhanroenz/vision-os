export const TURN_PACKET_PREFIX = "[TURN packet]";
export const TURN_PACKET_META = { brief: true, kind: "turn_packet" };

export function isAgentBriefMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.meta?.brief === true) return true;
  const content = String(message.content ?? "");
  if (content.startsWith(TURN_PACKET_PREFIX)) return true;
  if (content.startsWith("[Agent step context")) return true;
  if (content.startsWith("[Acceptance criteria")) return true;
  if (content.startsWith("[Verification checklist")) return true;
  if (content.startsWith("[Next moves")) return true;
  if (content.startsWith("[Workspace awareness")) return true;
  if (content.startsWith("[Intent assessment")) return true;
  if (content.startsWith("[Workspace file map")) return true;
  if (content.startsWith("[Execution commit")) return true;
  if (content.startsWith("[Handoff brief")) return true;
  if (content.startsWith("[Turn start")) return true;
  if (content.startsWith("[Fix follow-up")) return true;
  if (content.startsWith("[Stale plan")) return true;
  if (content.startsWith("[Brain preflight")) return true;
  if (content.startsWith("[Explicit tool runbook")) return true;
  return false;
}

/**
 * Remove accumulated server briefs; keep real user turns and assistant/tool chain.
 */
export function pruneStaleBriefs(conversation) {
  if (!conversation?.llmMessages) return 0;
  const before = conversation.llmMessages.length;
  conversation.llmMessages = conversation.llmMessages.filter(
    (m) => m.role === "system" || !isAgentBriefMessage(m),
  );
  return before - conversation.llmMessages.length;
}

export function pushTurnPacket(conversation, content) {
  if (!content?.trim()) return false;
  pruneTurnPackets(conversation);
  conversation.llmMessages.push({
    role: "user",
    content: content.trim(),
    meta: { ...TURN_PACKET_META },
  });
  return true;
}

export function pruneTurnPackets(conversation) {
  if (!conversation?.llmMessages) return;
  conversation.llmMessages = conversation.llmMessages.filter(
    (m) =>
      !(
        m.meta?.kind === "turn_packet" ||
        String(m.content ?? "").startsWith(TURN_PACKET_PREFIX)
      ),
  );
}
