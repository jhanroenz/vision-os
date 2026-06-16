import { createChatCompletion } from "../slots.js";
import { extractCompletionText } from "../reasoning.js";

const SYNTH_SYSTEM = `You are Jarvis — Master Jan's research analyst.
Write analyst-quality research reports in Markdown.
Do not use inline footnote markers like [^1] — sources are listed in the Sources section and source cards in the UI.
Do not tell the reader to visit links instead of answering.
Identify consensus and disagreements when sources conflict.`;

/**
 * @param {{
 *   userQuery: string,
 *   sources: Array<object>,
 *   claims: Array<object>,
 *   contradictions: Array<object>,
 *   brainBaseline?: string,
 * }} ctx
 */
export async function synthesizeResearchReport(ctx) {
  const { userQuery, sources, claims, contradictions, brainBaseline } = ctx;

  const citationBlock = sources
    .slice(0, 30)
    .map((s) => `- [${s.title}](${s.url}) — ${s.domain}${s.publishedAt ? ` — ${s.publishedAt}` : ""}`)
    .join("\n");

  const claimsBlock = claims
    .slice(0, 40)
    .map((c) => `- [${c.sourceId}] ${c.text}`)
    .join("\n");

  const contraBlock = contradictions.length
    ? contradictions
        .map(
          (c) =>
            `Topic: ${c.topic}\n${c.claims.map((x) => `  - ${x.text}`).join("\n")}\n${c.analysis ?? ""}`,
        )
        .join("\n\n")
    : "(none detected)";

  const userContent = `Research question: ${userQuery}

${brainBaseline ? `Known baseline from brain memory:\n${brainBaseline}\n\n` : ""}Extracted claims:
${claimsBlock || "(sparse — use source snippets)"}

Contradictions:
${contraBlock}

Write a complete report with EXACTLY these sections as H1 headings:
# Executive Summary
# Key Findings
# Detailed Analysis
# Supporting Evidence
# Contradictions and Disagreements
# Media Gallery
# Sources

In Media Gallery, list discovered media titles and note they appear in the gallery UI (use bullet list).
Do not use [^n] footnote markers in the body — cite sources by title in prose where helpful; full URLs go in the Sources section only.

Source list for the Sources section (use markdown links):
${citationBlock}`;

  try {
    const response = await createChatCompletion(
      [
        { role: "system", content: SYNTH_SYSTEM },
        { role: "user", content: userContent },
      ],
      {
        maxTokens: 4096,
        temperature: 0.25,
      },
    );

    const text = extractCompletionText(response)?.trim();
    if (text && text.length > 200) return text;
  } catch {
    // fall through to template
  }

  return buildFallbackReport(ctx);
}

function buildFallbackReport({ userQuery, sources, claims, contradictions }) {
  const lines = [
    `# Executive Summary`,
    `Research on **${userQuery}** gathered ${sources.length} sources.`,
    "",
    `# Key Findings`,
  ];

  for (const claim of claims.slice(0, 8)) {
    const src = sources.find((s) => s.id === claim.sourceId);
    lines.push(`- ${claim.text}${src ? ` [${src.title}](${src.url})` : ""}`);
  }

  lines.push("", `# Detailed Analysis`, "");
  for (const source of sources.slice(0, 10)) {
    lines.push(`## ${source.title}`, "", source.snippet || source.pageText?.slice(0, 400) || "", "");
  }

  lines.push(`# Supporting Evidence`, "");
  for (const source of sources.slice(0, 15)) {
    lines.push(`- [${source.title}](${source.url}) — reliability ${source.reliabilityScore?.toFixed(2)}`);
  }

  lines.push("", `# Contradictions and Disagreements`, "");
  if (contradictions.length) {
    for (const c of contradictions) {
      lines.push(`## ${c.topic}`, c.analysis ?? "", "");
    }
  } else {
    lines.push("No major contradictions detected in collected material.");
  }

  lines.push("", `# Media Gallery`, "", "See the interactive media gallery below the report.", "", `# Sources`, "");
  for (const source of sources) {
    lines.push(`- [${source.title}](${source.url}) — reliability ${source.reliabilityScore?.toFixed(2)}`);
  }

  return lines.join("\n");
}

export { buildFallbackReport };
