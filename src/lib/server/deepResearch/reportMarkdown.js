/** Inline footnote refs: [^1], [^7], [^046db946], etc. */
const FOOTNOTE_REF = /\[\^[^\]]+\]/g;

/** Footnote definition lines at end of report: [^1]: Title — url */
const FOOTNOTE_DEF_LINE = /^\[\^[^\]]+\]:[^\n]*\n?/gm;

/** Leaked internal source/claim ids from the synthesis prompt: [src-046db946], [046db946] */
const INTERNAL_ID_REF =
  /\[(?:src-|claim-|media-)?[a-f0-9]{6,12}\]/gi;

/**
 * Strip footnote markers and leaked source-id refs from research report markdown.
 * Sources remain in the Sources section, source cards, and report JSON.
 * @param {string} markdown
 * @returns {string}
 */
export function cleanResearchReportMarkdown(markdown) {
  let text = String(markdown ?? "");

  text = text.replace(/(?:\s*\[\^[^\]]+\])+/g, "");
  text = text.replace(/(?:\s*\[(?:src-|claim-|media-)?[a-f0-9]{6,12}\])+/gi, "");
  text = text.replace(FOOTNOTE_DEF_LINE, "");

  text = text.replace(/ {2,}/g, " ");
  text = text.replace(/ +([.,;:])/g, "$1");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

export { FOOTNOTE_REF, FOOTNOTE_DEF_LINE, INTERNAL_ID_REF };
