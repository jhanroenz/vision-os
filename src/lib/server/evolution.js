import { createChatCompletion } from "./slots.js";
import { getConversation, resolveLlmMessages } from "./conversations.js";
import { upsertMemory } from "./coreMemory.js";
import { upsertSkill } from "./skills.js";
import { config } from "./config.js";
import { minifyTranscript } from "./minify.js";
import { normalizeBrainProject } from "./brainProject.js";

const lastAutoReflect = new Map();

const BRAIN_SAVE_PATTERNS = [
  /\bsave\b.*\b(brain|memory|core memory)\b/i,
  /\b(brain|memory|core memory)\b.*\bsave\b/i,
  /\bstore\b.*\b(brain|memory|core memory)\b/i,
  /\bsave\s+(it|this|them|that|the results?)\s+to\s+(your\s+)?(brain|memory)\b/i,
  /\bremember\s+(this|it|them|that|these details?)\b/i,
];

const EXTRACT_PROMPT = `You analyze a conversation between Master Jan and Jarvis (a local AI assistant).
Extract ONLY durable, high-value knowledge worth persisting across all future chats.

Return ONLY valid JSON (no markdown):
{
  "memories": [
    { "title": "short label", "content": "detail", "category": "preference|project|fact|workflow|fix", "importance": 1-5 }
  ],
  "skills": [
    { "name": "short name", "description": "one line", "instructions": "actionable steps" }
  ]
}

Save ONLY:
- Issue fixes / root causes that should not recur (category: fix, importance: 5)
- Critical project mental notes (paths, stack, conventions) — importance 4–5
- Lasting preferences or workflows that change how Jarvis should act — importance 4+

Do NOT save:
- One-off chatter, greetings, or task progress
- Obvious or temporary details
- Secrets unless clearly intended

Rules:
- Empty arrays are fine if nothing qualifies
- Max 3 memories and 2 skills per reflection
- Skip anything below importance 4`;

function parseExtractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : trimmed;

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Reflect response did not contain JSON");
  }

  return JSON.parse(raw.slice(start, end + 1));
}

function recentMessages(messages, maxTurns) {
  const filtered = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );
  return filtered.slice(-maxTurns * 2);
}

function formatTranscript(messages) {
  return messages
    .map((m) => {
      const text =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${m.role}: ${text}`;
    })
    .join("\n\n");
}

export async function reflectConversation(conversationId) {
  const conversation = await getConversation(conversationId);
  if (!conversation) throw new Error("Conversation not found");

  const messages = await resolveLlmMessages(conversation);
  const transcript = formatTranscript(
    minifyTranscript(recentMessages(messages, config.evolution.reflectTurns)),
  );

  if (!transcript.trim()) {
    return { memories: [], skills: [], saved: { memories: 0, skills: 0 } };
  }

  const completion = await createChatCompletion(
    [
      { role: "system", content: EXTRACT_PROMPT },
      {
        role: "user",
        content: `Conversation transcript:\n\n${transcript}`,
      },
    ],
    { maxTokens: 2048, temperature: 0.1 },
  );

  const raw = completion.choices?.[0]?.message?.content ?? "";
  const parsed = parseExtractJson(raw);

  const minImportance = config.evolution.reflectMinImportance;
  const memoryCandidates = (parsed.memories ?? [])
    .filter((m) => m?.title?.trim() && m?.content?.trim())
    .map((m) => ({
      ...m,
      importance: Math.min(5, Math.max(1, Number(m.importance) || minImportance)),
    }))
    .filter((m) => m.importance >= minImportance)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, config.evolution.reflectMaxMemories);

  const skillCandidates = (parsed.skills ?? [])
    .filter(
      (s) =>
        s?.name?.trim() && s?.description?.trim() && s?.instructions?.trim(),
    )
    .slice(0, config.evolution.reflectMaxSkills);

  const { getActiveProjectRoot } = await import("./workspace.js");
  const project = normalizeBrainProject(getActiveProjectRoot(conversationId));

  const savedMemories = [];
  for (const m of memoryCandidates) {
    savedMemories.push(
      await upsertMemory({
        title: m.title,
        content: m.content,
        category: m.category ?? null,
        importance: m.importance,
        project,
        source: "agent",
        sourceConversationId: conversationId,
        enabled: true,
      }),
    );
  }

  const savedSkills = [];
  for (const s of skillCandidates) {
    savedSkills.push(
      await upsertSkill({
        name: s.name,
        description: s.description,
        instructions: s.instructions,
        project,
        source: "agent",
        sourceConversationId: conversationId,
        enabled: true,
      }),
    );
  }

  return {
    memories: savedMemories,
    skills: savedSkills,
    saved: { memories: savedMemories.length, skills: savedSkills.length },
  };
}

function evolutionToolUsed(toolEvents, name) {
  return toolEvents?.some((e) => e.name === name);
}

function userWantsBrainSave(message) {
  return message && BRAIN_SAVE_PATTERNS.some((p) => p.test(message));
}

export async function maybeAutoReflect(
  conversationId,
  toolEvents,
  { mode = "chat", userMessage, casualChat = false } = {},
) {
  if (mode !== "chat") return null;
  if (!config.evolution.autoReflect) return null;
  if (casualChat && (!toolEvents?.length)) return null;
  if (
    evolutionToolUsed(toolEvents, "remember") ||
    evolutionToolUsed(toolEvents, "learn_skill")
  ) {
    return null;
  }

  const conversation = await getConversation(conversationId);
  if (!conversation) return null;

  const userTurns = conversation.llmMessages.filter((m) => m.role === "user").length;
  if (userTurns < config.evolution.autoReflectMinTurns) return null;

  const urgent = userWantsBrainSave(userMessage);
  const last = lastAutoReflect.get(conversationId) ?? 0;
  if (
    !urgent &&
    Date.now() - last < config.evolution.autoReflectDebounceMs
  ) {
    return null;
  }

  try {
    const result = await reflectConversation(conversationId);
    lastAutoReflect.set(conversationId, Date.now());
    if (result.saved.memories === 0 && result.saved.skills === 0) {
      return null;
    }
    return result;
  } catch (error) {
    console.warn("Auto-reflect failed:", error.message);
    return null;
  }
}
