import { checkMarkup, extractVueScript } from "./markup.js";
import {
  collectTreeErrors,
  grammarForPath,
  parseSourceFile,
} from "./ast/parse.js";

export { EXT_TO_GRAMMAR } from "./grammars.js";
export { grammarForPath, astSupportedForPath } from "./ast/parse.js";

/**
 * @param {string} filePath
 * @param {string} content
 */
export async function checkSyntaxWithTreeSitter(filePath, content) {
  const text = String(content ?? "");
  const grammarKey = grammarForPath(filePath);
  if (!grammarKey) {
    return {
      grammar: null,
      errors: [
        {
          line: 1,
          message: "No tree-sitter grammar for this file extension",
        },
      ],
    };
  }

  const errors = [...checkMarkup(text, filePath)];

  if (grammarKey === "vue-composite") {
    const script = extractVueScript(text);
    if (script?.code.trim()) {
      const scriptParsed = await parseSourceFile(
        script.lang === "typescript" ? "x.ts" : "x.js",
        script.code,
      );
      if (scriptParsed.root) {
        const scriptErrors = [];
        collectTreeErrors(scriptParsed.root, scriptErrors);
        const scriptOpen = text.match(/<script[^>]*>/i);
        const lineOffset = scriptOpen
          ? text.slice(0, scriptOpen.index).split("\n").length
          : 0;
        for (const err of scriptErrors) {
          err.line += lineOffset;
          err.message = `script: ${err.message}`;
        }
        errors.push(...scriptErrors);
      }
    }
    return { grammar: "vue", errors };
  }

  const parsed = await parseSourceFile(filePath, text);
  if (parsed.error && !parsed.root) {
    errors.push({ line: 1, message: parsed.error });
    return { grammar: parsed.grammar ?? grammarKey, errors };
  }

  if (parsed.root) {
    const parseErrors = [];
    collectTreeErrors(parsed.root, parseErrors);
    if (parsed.lineOffset) {
      for (const err of parseErrors) {
        err.line += parsed.lineOffset;
      }
    }
    errors.push(...parseErrors);
  }

  return { grammar: parsed.grammar ?? grammarKey, errors };
}
