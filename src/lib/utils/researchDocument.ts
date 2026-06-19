import type { ResearchDocument, ResearchDocumentSection, ResearchTier } from '$lib/api/research';

const SECTION_SLUG = /[^a-z0-9]+/g;

function slugify(title: string): string {
  return title.toLowerCase().replace(SECTION_SLUG, '_').replace(/^_|_$/g, '').slice(0, 48) || 'section';
}

/**
 * Parse markdown H1 sections for legacy sessions without structured document JSON.
 */
export function parseMarkdownSections(markdown: string): ResearchDocumentSection[] {
  const text = String(markdown ?? '').trim();
  if (!text) return [];

  const lines = text.split('\n');
  const sections: ResearchDocumentSection[] = [];
  let current: ResearchDocumentSection | null = null;

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) {
      if (current) sections.push(current);
      const title = h1[1].trim();
      current = { id: slugify(title), title, level: 1, bodyMarkdown: '', figures: [] };
      continue;
    }
    if (current) {
      current.bodyMarkdown += (current.bodyMarkdown ? '\n' : '') + line;
    }
  }
  if (current) sections.push({ ...current, bodyMarkdown: current.bodyMarkdown.trim() });

  const seen = new Map<string, number>();
  return sections.map((s) => {
    const n = (seen.get(s.id) ?? 0) + 1;
    seen.set(s.id, n);
    return { ...s, id: n > 1 ? `${s.id}_${n}` : s.id };
  });
}

function extractDeck(markdown: string): string {
  const afterFirst = markdown.split(/^#\s+/m).slice(1);
  if (!afterFirst.length) return '';
  const lines = afterFirst[0].split('\n').slice(1);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const quote = trimmed.match(/^>\s*(.+)$/);
    if (quote) return quote[1].trim();
    break;
  }
  return '';
}

export function buildDocumentFromMarkdown(
  markdown: string,
  userQuery: string,
  tier: ResearchTier = 'standard'
): ResearchDocument {
  const sections = parseMarkdownSections(markdown);
  const title = userQuery.replace(/\?+$/, '').trim() || 'Research Report';
  const deck = extractDeck(markdown) || 'Investigative research report';

  return {
    documentType: 'investigative',
    templateLabel: 'Investigative Report',
    title,
    deck,
    generatedAt: Date.now(),
    tier,
    sections,
    stats: { sources: 0, images: 0, videos: 0, inlineFigures: 0 }
  };
}
