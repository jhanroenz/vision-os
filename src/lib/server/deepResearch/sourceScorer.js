const OFFICIAL_PATTERNS = [
  /\.(gov|edu)(\.|$)/i,
  /^(docs|developer|developers|www)\./i,
  /\/docs?\//i,
  /\/documentation\//i,
  /\/blog\//i,
  /github\.com\/[^/]+\/[^/]+\/(releases|blob|wiki)/i,
];

const ACADEMIC_PATTERNS = [
  /arxiv\.org/i,
  /scholar\./i,
  /doi\.org/i,
  /pubmed/i,
  /ieee\.org/i,
  /acm\.org/i,
];

const NEWS_PATTERNS = [
  /news\./i,
  /\/news\//i,
  /reuters\.com/i,
  /bbc\.(com|co)/i,
  /techcrunch\.com/i,
];

const FORUM_PATTERNS = [
  /stackoverflow\.com/i,
  /reddit\.com/i,
  /news\.ycombinator\.com/i,
  /discourse\./i,
];

/**
 * @returns {'official' | 'academic' | 'news' | 'blog' | 'forum' | 'docs' | 'other'}
 */
export function classifySourceType(url, title = "") {
  const text = `${url} ${title}`.toLowerCase();
  if (ACADEMIC_PATTERNS.some((p) => p.test(text))) return "academic";
  if (FORUM_PATTERNS.some((p) => p.test(text))) return "forum";
  if (NEWS_PATTERNS.some((p) => p.test(text))) return "news";
  if (/\/docs?\//i.test(url) || /documentation/i.test(title)) return "docs";
  if (OFFICIAL_PATTERNS.some((p) => p.test(url))) return "official";
  if (/medium\.com|dev\.to|substack\.com/i.test(url)) return "blog";
  return "other";
}

/**
 * @returns {number} 0–1
 */
export function scoreReliability(url, sourceType) {
  const domain = String(url ?? "").toLowerCase();
  let score = 0.45;

  switch (sourceType) {
    case "official":
      score = 0.92;
      break;
    case "docs":
      score = 0.88;
      break;
    case "academic":
      score = 0.9;
      break;
    case "news":
      score = 0.72;
      break;
    case "forum":
      score = 0.48;
      break;
    case "blog":
      score = 0.55;
      break;
    default:
      score = 0.5;
  }

  if (/wikipedia\.org/i.test(domain)) score = Math.max(score, 0.65);
  if (/youtube\.com|youtu\.be/i.test(domain)) score = Math.min(score, 0.6);
  if (/\.(gov|edu)(\.|$)/i.test(domain)) score = Math.max(score, 0.9);

  return Math.min(1, Math.max(0, score));
}
