import Parser from "web-tree-sitter";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../../config.js";
import { extractVueScript } from "../markup.js";
import { EXT_TO_GRAMMAR } from "../grammars.js";

const PACKAGE_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const WASM_DIR = path.join(PACKAGE_ROOT, "node_modules/tree-sitter-wasms/out");

/** @type {Map<string, import('web-tree-sitter').Language>} */
const languageCache = new Map();
let initPromise = null;

export function grammarForPath(filePath) {
  const ext = path.extname(String(filePath ?? "")).replace(/^\./, "").toLowerCase();
  if (ext === "vue") return "vue-composite";
  return EXT_TO_GRAMMAR[ext] ?? null;
}

export function astSupportedForPath(filePath) {
  return Boolean(grammarForPath(filePath));
}

async function ensureParserReady() {
  if (!initPromise) {
    initPromise = Parser.init();
  }
  await initPromise;
}

async function loadLanguage(grammar) {
  if (languageCache.has(grammar)) {
    return languageCache.get(grammar);
  }
  await ensureParserReady();
  const wasmPath = path.join(WASM_DIR, `tree-sitter-${grammar}.wasm`);
  const language = await Parser.Language.load(wasmPath);
  languageCache.set(grammar, language);
  return language;
}

function scriptLineOffset(content) {
  const idx = content.match(/<script[^>]*>/i)?.index;
  if (idx == null) return 0;
  return content.slice(0, idx).split("\n").length;
}

/**
 * @param {string} grammar
 * @param {string} code
 */
async function parseGrammar(grammar, code) {
  const language = await loadLanguage(grammar);
  const parser = new Parser();
  parser.setLanguage(language);
  const text = String(code ?? "");
  const tree = parser.parse(text);
  return { root: tree.rootNode, text, grammar };
}

/**
 * @param {import('web-tree-sitter').Node} node
 * @param {Array<{ line: number, column: number, message: string }>} errors
 * @param {number} max
 */
export function collectTreeErrors(node, errors, max = 20) {
  if (errors.length >= max) return;
  if (node.type === "ERROR" || node.isMissing()) {
    const start = node.startPosition;
    errors.push({
      line: start.row + 1,
      column: start.column + 1,
      message: node.isMissing()
        ? `Missing ${node.type} node`
        : `Syntax error (${node.type})`,
    });
  }
  for (let i = 0; i < node.childCount; i++) {
    collectTreeErrors(node.child(i), errors, max);
  }
}

/**
 * @param {string} filePath
 * @param {string} content
 */
export async function parseSourceFile(filePath, content) {
  if (!config.codeCheck.syntaxEnabled) {
    return {
      grammar: null,
      root: null,
      text: String(content ?? ""),
      lineOffset: 0,
      error: "AST disabled (CODE_CHECK_SYNTAX_ENABLED=false)",
    };
  }

  const text = String(content ?? "");
  if (text.length > config.codeCheck.maxFileBytes) {
    return {
      grammar: null,
      root: null,
      text,
      lineOffset: 0,
      error: `File exceeds ${config.codeCheck.maxFileBytes} byte AST limit`,
    };
  }

  const grammarKey = grammarForPath(filePath);
  if (!grammarKey) {
    return {
      grammar: null,
      root: null,
      text,
      lineOffset: 0,
      error: "No tree-sitter grammar for this extension",
    };
  }

  try {
    if (grammarKey === "vue-composite") {
      const script = extractVueScript(text);
      if (!script?.code.trim()) {
        return {
          grammar: "vue",
          root: null,
          text,
          lineOffset: 0,
          error: "Vue SFC has no script block to parse",
        };
      }
      const parsed = await parseGrammar(script.lang, script.code);
      return {
        grammar: "vue",
        root: parsed.root,
        text: parsed.text,
        lineOffset: scriptLineOffset(text),
      };
    }

    const parsed = await parseGrammar(grammarKey, text);
    return {
      grammar: parsed.grammar,
      root: parsed.root,
      text: parsed.text,
      lineOffset: 0,
    };
  } catch (err) {
    return {
      grammar: grammarKey,
      root: null,
      text,
      lineOffset: 0,
      error: `Parser failed: ${err.message ?? err}`,
    };
  }
}
