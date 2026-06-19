import { createChatCompletion } from "../slots.js";
import { extractCompletionText } from "../reasoning.js";
import { formatSectionListForPrompt } from "./templateRegistry.js";

const SYNTH_SYSTEM = `You are Jarvis — Master Jan's research analyst.
Write professional research documents in Markdown for publication in a research magazine.
Do not use inline footnote markers like [^1] — sources are listed in the Sources/References section.
Do not tell the reader to visit links instead of answering.
Identify consensus and disagreements when sources conflict.
Do not include a Media Gallery section — images are placed inline via HTML comment placeholders only.`;

/**
 * @param {{
 *   userQuery: string,
 *   sources: Array<object>,
 *   claims: Array<object>,
 *   contradictions: Array<object>,
 *   brainBaseline?: string,
 *   documentType?: string,
 *   template?: import('./templateRegistry.js').ResearchTemplate,
 *   media?: Array<object>,
 *   tier?: string,
 * }} ctx
 */
export async function synthesizeResearchReport(ctx) {
  const {
    userQuery,
    sources,
    claims,
    contradictions,
    brainBaseline,
    template,
    media = [],
    tier = "standard",
  } = ctx;

  const citationBlock = sources
    .slice(0, 30)
    .map((s) => `- [${s.title}](${s.url}) — ${s.domain}${s.publishedAt ? ` — ${s.publishedAt}` : ""}`)
    .join("\n");

  const claimsBlock = claims
    .slice(0, 40)
    .map((c) => `- ${c.text}`)
    .join("\n");

  const contraBlock = contradictions.length
    ? contradictions
        .map(
          (c) =>
            `Topic: ${c.topic}\n${c.claims.map((x) => `  - ${x.text}`).join("\n")}\n${c.analysis ?? ""}`,
        )
        .join("\n\n")
    : "(none detected)";

  const mediaBlock = media
    .filter((m) => m.type === "image")
    .slice(0, 12)
    .map((m) => `- id=${m.id} title="${m.title ?? ""}" caption="${m.caption ?? ""}"`)
    .join("\n");

  const sectionList = template
    ? formatSectionListForPrompt(template)
    : formatSectionListForPrompt({ sections: [] });

  const styleGuide = template?.synthesisInstructions ?? "Write clearly and professionally.";

  const userContent = `Research question: ${userQuery}
Document type: ${template?.label ?? "Investigative Report"}

${brainBaseline ? `Known baseline from brain memory:\n${brainBaseline}\n\n` : ""}Style guide:
${styleGuide}

Extracted claims:
${claimsBlock || "(sparse — use source snippets)"}

Contradictions:
${contraBlock}

Available images for inline figures (use HTML comment placeholders, max 1-2 per section):
${mediaBlock || "(none)"}

Figure placeholder format (place on its own line within the relevant section):
<!-- research:figure section=<sectionId> media=<mediaId> caption="Short caption" -->

Write a complete report with EXACTLY these sections as H1 headings in this order:
${sectionList}

After the first H1 title line, add a one-line deck as a blockquote (> ...) summarizing the report.

Do not use [^n] footnote markers in the body — cite sources by title in prose where helpful; full URLs go in the Sources/References section only.
Do not include a Media Gallery section.

Source list for the Sources/References section (use markdown links):
${citationBlock}`;

  const maxTokens = tier === "deep" || tier === "exhaustive" ? 6144 : 4096;

  try {
    const response = await createChatCompletion(
      [
        { role: "system", content: SYNTH_SYSTEM },
        { role: "user", content: userContent },
      ],
      {
        maxTokens,
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

/**
 * @param {Parameters<typeof synthesizeResearchReport>[0]} ctx
 */
function buildFallbackReport(ctx) {
  const { userQuery, sources, claims, contradictions, template, media = [] } = ctx;
  const sections = template?.sections ?? [
    { id: "lede", title: "Lede", promptHint: "" },
    { id: "key_findings", title: "Key Findings", promptHint: "" },
    { id: "deep_dive", title: "Deep Dive", promptHint: "" },
    { id: "sources", title: "Sources", promptHint: "" },
  ];

  const lines = [];
  const contentSections = sections.filter((s) => !/sources|references/i.test(s.title));
  const sourcesSection = sections.find((s) => /sources|references/i.test(s.title));

  for (let i = 0; i < contentSections.length; i++) {
    const sec = contentSections[i];
    lines.push(`# ${sec.title}`, "");

    if (i === 0) {
      lines.push(`> Research on **${userQuery}** gathered ${sources.length} sources.`, "");
    }

    if (/key findings|findings|executive/i.test(sec.title)) {
      for (const claim of claims.slice(0, 8)) {
        const src = sources.find((s) => s.id === claim.sourceId);
        lines.push(`- ${claim.text}${src ? ` (${src.title})` : ""}`);
      }
      lines.push("");
    } else if (/contradiction|disagreement/i.test(sec.title)) {
      if (contradictions.length) {
        for (const c of contradictions) {
          lines.push(`## ${c.topic}`, c.analysis ?? "", "");
        }
      } else {
        lines.push("No major contradictions detected in collected material.", "");
      }
    } else if (/deep dive|analysis|overview|background/i.test(sec.title)) {
      for (const source of sources.slice(0, 6)) {
        lines.push(`## ${source.title}`, "", source.snippet || source.pageText?.slice(0, 400) || "", "");
      }
    } else {
      lines.push(`Analysis of ${userQuery} based on ${sources.length} collected sources.`, "");
    }

    const sectionImages = media.filter((m) => m.type === "image").slice(i, i + 1);
    for (const img of sectionImages) {
      lines.push(
        `<!-- research:figure section=${sec.id} media=${img.id} caption="${(img.caption || img.title || "").replace(/"/g, "'")}" -->`,
        "",
      );
    }
  }

  if (sourcesSection) {
    lines.push(`# ${sourcesSection.title}`, "");
    for (const source of sources) {
      lines.push(`- [${source.title}](${source.url}) — reliability ${source.reliabilityScore?.toFixed(2) ?? "n/a"}`);
    }
  }

  return lines.join("\n");
}

export { buildFallbackReport };
