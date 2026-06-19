/**
 * Research document templates — section schemas and synthesis hints.
 * @typedef {{ id: string, title: string, promptHint: string }} TemplateSection
 * @typedef {{
 *   id: string,
 *   label: string,
 *   sections: TemplateSection[],
 *   synthesisInstructions: string,
 * }} ResearchTemplate
 */

/** @type {Record<string, ResearchTemplate>} */
export const RESEARCH_TEMPLATES = {
  entity_profile: {
    id: "entity_profile",
    label: "Entity Profile",
    synthesisInstructions: `Write in a polished biography or company profile style suitable for a research magazine.
Use narrative paragraphs with clear chronology where relevant. Include a compelling one-line deck under the title.
Use blockquotes sparingly for notable quotes or defining statements.
Lead with the most distinctive facts about the subject.`,
    sections: [
      { id: "overview", title: "Overview", promptHint: "Who or what this entity is; role, significance, and current status." },
      { id: "timeline", title: "Timeline", promptHint: "Key dates and milestones in chronological order." },
      { id: "relationships", title: "Key Relationships & Leadership", promptHint: "People, partners, subsidiaries, board, or affiliations that matter." },
      { id: "impact", title: "Impact & Significance", promptHint: "Why this entity matters; achievements, influence, market position." },
      { id: "recent", title: "Recent Developments", promptHint: "Latest news, announcements, or changes." },
      { id: "sources", title: "Sources", promptHint: "Numbered bibliography with markdown links. No inline footnotes." },
    ],
  },
  scientific: {
    id: "scientific",
    label: "Scientific Research",
    synthesisInstructions: `Write in formal scientific communication style — precise, evidence-led, and structured.
Use measured language; distinguish established findings from preliminary results.
Include methodology discussion where sources permit. Use blockquotes only for direct study conclusions.`,
    sections: [
      { id: "abstract", title: "Abstract", promptHint: "Concise summary of the research topic, methods, and principal findings." },
      { id: "background", title: "Background", promptHint: "Context, prior work, and why this topic matters scientifically." },
      { id: "methods", title: "Methods & Evidence", promptHint: "How research was conducted; data sources, trials, or experimental approaches." },
      { id: "findings", title: "Findings", promptHint: "Principal results and what they mean." },
      { id: "limitations", title: "Limitations & Open Questions", promptHint: "Gaps, uncertainties, and areas needing further study." },
      { id: "references", title: "References", promptHint: "Numbered reference list with markdown links." },
    ],
  },
  market_industry: {
    id: "market_industry",
    label: "Market & Industry Brief",
    synthesisInstructions: `Write as an executive industry brief for decision-makers.
Be analytical and forward-looking. Quantify where sources provide figures.
Use clear subheads within sections when helpful. Highlight competitive dynamics.`,
    sections: [
      { id: "executive_brief", title: "Executive Brief", promptHint: "Top-line summary for busy executives — size, growth, and key takeaway." },
      { id: "landscape", title: "Market Landscape", promptHint: "Market size, segments, geography, and structural dynamics." },
      { id: "players", title: "Key Players", promptHint: "Major companies, startups, or institutions shaping the space." },
      { id: "trends", title: "Trends & Drivers", promptHint: "What's driving growth or change; technology, regulation, consumer behavior." },
      { id: "risks", title: "Risks & Challenges", promptHint: "Headwinds, regulatory risk, disruption threats." },
      { id: "outlook", title: "Outlook", promptHint: "Near- to medium-term forecast and strategic implications." },
      { id: "sources", title: "Sources", promptHint: "Numbered source list with markdown links." },
    ],
  },
  technology: {
    id: "technology",
    label: "Technology Deep Dive",
    synthesisInstructions: `Write for technically literate readers — clear explanations without oversimplifying.
Explain architecture, capabilities, and trade-offs. Compare alternatives where relevant.
Use analogies sparingly and only when they clarify complex concepts.`,
    sections: [
      { id: "overview", title: "Overview", promptHint: "What this technology is and its primary use cases." },
      { id: "how_it_works", title: "How It Works", promptHint: "Core mechanisms, architecture, or technical approach." },
      { id: "adoption", title: "Adoption & Ecosystem", promptHint: "Who uses it, integrations, community, and maturity." },
      { id: "comparisons", title: "Comparisons", promptHint: "Alternatives, competitors, and differentiators." },
      { id: "future", title: "Future Direction", promptHint: "Roadmap, emerging trends, and predicted evolution." },
      { id: "sources", title: "Sources", promptHint: "Numbered source list with markdown links." },
    ],
  },
  investigative: {
    id: "investigative",
    label: "Investigative Report",
    synthesisInstructions: `Write in magazine investigative style — engaging lede, rigorous evidence, clear narrative arc.
Balance readability with analytical depth. Surface consensus and disagreement explicitly.
Use pull quotes (blockquotes) for the most striking sourced statements.`,
    sections: [
      { id: "lede", title: "Lede", promptHint: "Opening narrative that frames the topic and why it matters now." },
      { id: "key_findings", title: "Key Findings", promptHint: "Bullet or short-paragraph summary of the most important discoveries." },
      { id: "deep_dive", title: "Deep Dive", promptHint: "Detailed analysis organized by theme or subtopic." },
      { id: "evidence", title: "Evidence & Analysis", promptHint: "Supporting facts, data points, and source-backed reasoning." },
      { id: "contradictions", title: "Contradictions & Disagreements", promptHint: "Where sources conflict and how to interpret the disagreement." },
      { id: "sources", title: "Sources", promptHint: "Numbered source list with markdown links." },
    ],
  },
};

/**
 * @param {string} documentType
 * @returns {ResearchTemplate}
 */
export function getTemplate(documentType) {
  return RESEARCH_TEMPLATES[documentType] ?? RESEARCH_TEMPLATES.investigative;
}

/**
 * @param {ResearchTemplate} template
 * @returns {string}
 */
export function formatSectionListForPrompt(template) {
  return template.sections
    .map((s) => `# ${s.title}\n(${s.promptHint})`)
    .join("\n\n");
}
