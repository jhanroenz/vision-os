import { createChatCompletion } from "../slots.js";
import { extractCompletionText } from "../reasoning.js";
import { getTemplate } from "./templateRegistry.js";

const VALID_TYPES = new Set([
  "entity_profile",
  "scientific",
  "market_industry",
  "technology",
  "investigative",
]);

/**
 * Heuristic fallback when LLM classification fails.
 * @param {string} userQuery
 * @returns {{ documentType: string, subjectLabel: string, confidence: number }}
 */
export function classifyResearchTopicHeuristic(userQuery) {
  const q = String(userQuery ?? "").toLowerCase();

  if (
    /\b(who is|biography|life of|born in|ceo of|founder of|company profile)\b/.test(q) ||
    /\b(inc\.|corp\.|ltd\.|gmbh|plc)\b/.test(q)
  ) {
    return { documentType: "entity_profile", subjectLabel: userQuery.trim(), confidence: 0.6 };
  }

  if (
    /\b(study|clinical trial|peer.?review|meta.?analysis|research paper|journal|hypothesis|genome|molecule)\b/.test(q)
  ) {
    return { documentType: "scientific", subjectLabel: userQuery.trim(), confidence: 0.65 };
  }

  if (
    /\b(market size|industry|sector|tam|sam|competitive landscape|market share|forecast)\b/.test(q)
  ) {
    return { documentType: "market_industry", subjectLabel: userQuery.trim(), confidence: 0.6 };
  }

  if (
    /\b(framework|library|api|programming|software|protocol|architecture|how does .+ work)\b/.test(q)
  ) {
    return { documentType: "technology", subjectLabel: userQuery.trim(), confidence: 0.55 };
  }

  return { documentType: "investigative", subjectLabel: userQuery.trim(), confidence: 0.5 };
}

/**
 * @param {string} userQuery
 * @param {{ sources?: Array<{ title?: string, domain?: string }> }} [ctx]
 * @returns {Promise<{ documentType: string, subjectLabel: string, confidence: number, template: import('./templateRegistry.js').ResearchTemplate }>}
 */
export async function classifyResearchTopic(userQuery, ctx = {}) {
  const query = String(userQuery ?? "").trim();
  const sourceHints = (ctx.sources ?? [])
    .slice(0, 8)
    .map((s) => s.title || s.domain)
    .filter(Boolean)
    .join("; ");

  const system = `You classify research queries into document types for report formatting.
Respond with ONLY valid JSON: {"documentType":"...","subjectLabel":"...","confidence":0.0-1.0}
documentType must be one of: entity_profile, scientific, market_industry, technology, investigative
entity_profile = people, companies, organizations
scientific = studies, papers, medical/technical research
market_industry = markets, sectors, business trends
technology = products, tools, frameworks, technical systems
investigative = general topics, news, mixed investigations`;

  const user = `Query: ${query}
${sourceHints ? `Early sources: ${sourceHints}` : ""}`;

  try {
    const response = await createChatCompletion(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { maxTokens: 120, temperature: 0 },
    );

    const text = extractCompletionText(response)?.trim() ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const documentType = VALID_TYPES.has(parsed.documentType)
        ? parsed.documentType
        : "investigative";
      return {
        documentType,
        subjectLabel: String(parsed.subjectLabel ?? query).trim() || query,
        confidence: Number(parsed.confidence) || 0.7,
        template: getTemplate(documentType),
      };
    }
  } catch {
    // fall through
  }

  const fallback = classifyResearchTopicHeuristic(query);
  return { ...fallback, template: getTemplate(fallback.documentType) };
}
