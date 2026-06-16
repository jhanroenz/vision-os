import { config } from "./config.js";
import { createChatCompletion } from "./slots.js";
import { extractCompletionText } from "./reasoning.js";

const VALID_STYLES = new Set(["telegraph", "caveman", "bullet"]);

const STYLE_INSTRUCTIONS = {
  telegraph:
    "Telegraph style: drop articles and filler words, use pipes | or commas between facts, no full sentences unless needed.",
  caveman:
    "Ultra-short caveman English: short clauses, no articles, only essential facts (e.g. 'Master Jan = creator. Full-stack. IT degree.').",
  bullet:
    "Semicolon-separated micro-facts, no prose, abbreviate where obvious (e.g. eng, prefs, dir).",
};

function clampText(text, max) {
  if (!text || text.length <= max) return text?.trim() ?? "";
  return `${text.slice(0, max).trim()}…`;
}

function resolveStyle(style = config.evolution.compressStyle) {
  return VALID_STYLES.has(style) ? style : "telegraph";
}

export function ruleBasedCompress(text, maxChars, style = "telegraph") {
  if (!text?.trim()) return "";

  const selectedStyle = resolveStyle(style);
  let t = text
    .replace(/\s+/g, " ")
    .replace(/\b(the|a|an|is|are|was|were|be|been|being|that|which|who|whom|this|these|those|very|really|just|also|please)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (selectedStyle === "telegraph" || selectedStyle === "bullet") {
    const parts = t
      .split(/[.;!?]\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    t = parts.join(selectedStyle === "bullet" ? "; " : " | ");
  } else if (selectedStyle === "caveman") {
    const parts = t
      .split(/[.;!?]\s+/)
      .map((s) =>
        s
          .replace(/\b(I|you|we|they)\b/gi, "")
          .replace(/\b(will|would|could|should|can|cannot|can't)\b/gi, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean);
    t = parts.join(". ");
  }

  return clampText(t, maxChars);
}

async function compressWithLlm(kind, payload, maxChars) {
  const style = resolveStyle(config.evolution.compressStyle);
  const styleHint = STYLE_INSTRUCTIONS[style] ?? STYLE_INSTRUCTIONS.telegraph;

  const system = `You compress ${kind} for a local AI's system prompt. ${styleHint}
Hard limit: ${maxChars} characters.
Keep names, URLs, paths, numbers, and preferences. Drop fluff.
Do not think aloud or explain. Output ONLY the compressed text — no quotes, no markdown, no tags.`;

  const user =
    kind === "memory"
      ? `Title: ${payload.title}\nCategory: ${payload.category ?? "none"}\nContent:\n${payload.content}`
      : `Name: ${payload.name}\nDescription: ${payload.description}\nInstructions:\n${payload.instructions}`;

  const completion = await createChatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { maxTokens: 256, temperature: 0.1, cachePrompt: false },
  );

  const raw = extractCompletionText(completion);
  const cleaned = raw.replace(/^["']|["']$/g, "").trim();
  if (!cleaned) {
    const finish = completion?.choices?.[0]?.finish_reason ?? "unknown";
    throw new Error(`Empty compress response (finish_reason=${finish})`);
  }
  return clampText(cleaned, maxChars);
}

export async function compressMemoryForPrompt({ title, content, category }) {
  const max = config.evolution.compressMaxChars;
  const full = content.trim();

  if (!config.evolution.compressOnSave) {
    return clampText(full, max);
  }

  if (full.length <= Math.floor(max * 0.85)) {
    return ruleBasedCompress(full, max, resolveStyle());
  }

  try {
    return await compressWithLlm("memory", { title, content, category }, max);
  } catch (error) {
    console.warn("Memory compress LLM failed, using rule-based:", error.message);
    return ruleBasedCompress(full, max, resolveStyle());
  }
}

export async function compressSkillForPrompt({ name, description, instructions }) {
  const max = config.evolution.compressMaxChars;
  const full = `${name.trim()} — ${description.trim()}. ${instructions.trim()}`;

  if (!config.evolution.compressOnSave) {
    return clampText(full, max);
  }

  if (full.length <= Math.floor(max * 0.85)) {
    return ruleBasedCompress(full, max, resolveStyle());
  }

  try {
    return await compressWithLlm(
      "skill",
      { name, description, instructions },
      max,
    );
  } catch (error) {
    console.warn("Skill compress LLM failed, using rule-based:", error.message);
    return ruleBasedCompress(full, max, resolveStyle());
  }
}

export function memoryPromptBody(row) {
  const max = config.evolution.compressMaxChars;
  if (row.prompt_text?.trim()) {
    return clampText(row.prompt_text.trim(), max);
  }
  return clampText(row.content ?? "", config.evolution.memoryMaxChars);
}

export function skillPromptBody(row) {
  const max = config.evolution.compressMaxChars;
  if (row.prompt_text?.trim()) {
    return clampText(row.prompt_text.trim(), max);
  }
  const line = `${row.name}: ${row.description}. ${row.instructions}`;
  return clampText(line, config.evolution.skillMaxChars);
}
