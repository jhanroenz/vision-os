/**
 * Markup checks for Vue SFCs and loose HTML-like files.
 * @param {string} content
 * @param {string} [filePath]
 * @returns {Array<{ line: number, column?: number, message: string }>}
 */
export function checkMarkup(content, filePath = "") {
  const text = String(content ?? "");
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const errors = [];

  if (ext === "vue" || ext === "html" || ext === "htm") {
    errors.push(...checkBlockTags(text, ["template", "script", "style"]));
  }

  if (ext === "svg") {
    errors.push(...checkBlockTags(text, ["svg"]));
  }

  return errors;
}

/**
 * @param {string} content
 * @param {string[]} blockNames
 */
function checkBlockTags(content, blockNames) {
  const errors = [];
  for (const block of blockNames) {
    const openRe = new RegExp(`<${block}(\\s|>|/)`, "gi");
    const closeRe = new RegExp(`</${block}>`, "gi");
    const opens = [...content.matchAll(openRe)].filter(
      (m) => !isSelfClosingAt(content, m.index),
    );
    const closes = [...content.matchAll(closeRe)];
    if (opens.length && closes.length < opens.length) {
      const lastOpen = opens[opens.length - 1];
      const line = lineNumberAt(content, lastOpen.index ?? 0);
      errors.push({
        line,
        column: 1,
        message: `Missing </${block}> closing tag`,
      });
    }
  }
  return errors;
}

function isSelfClosingAt(content, index) {
  const slice = content.slice(index, index + 120);
  return /\/>\s*$/.test(slice.split("\n")[0] ?? slice);
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

/**
 * @param {string} content
 * @returns {{ lang: "typescript" | "javascript", code: string } | null}
 */
export function extractVueScript(content) {
  const text = String(content ?? "");
  const match = text.match(/<script([^>]*)>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  const attrs = match[1] ?? "";
  const code = match[2] ?? "";
  const lang =
    /lang\s*=\s*['"]ts['"]/i.test(attrs) ||
    /lang\s*=\s*['"]typescript['"]/i.test(attrs)
      ? "typescript"
      : "javascript";
  return { lang, code };
}
