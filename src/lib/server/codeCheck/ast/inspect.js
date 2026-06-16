import { parseSourceFile } from "./parse.js";
import { config } from "../../config.js";

const OUTLINE_NODE_TYPES = new Set([
  "import_statement",
  "import_from_statement",
  "export_statement",
  "function_declaration",
  "function_definition",
  "generator_function_declaration",
  "class_declaration",
  "class_definition",
  "lexical_declaration",
  "variable_declaration",
  "enum_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "method_definition",
  "decorated_definition",
]);

const DEFINITION_PARENT_TYPES = new Set([
  "function_declaration",
  "function_definition",
  "class_declaration",
  "class_definition",
  "method_definition",
  "lexical_declaration",
  "variable_declaration",
  "variable_declarator",
  "parameters",
  "required_parameter",
  "optional_parameter",
  "identifier",
  "property_identifier",
]);

function absLine(lineOffset, row) {
  return lineOffset + row + 1;
}

function nodeRange(node, lineOffset) {
  const start = absLine(lineOffset, node.startPosition.row);
  const end = absLine(lineOffset, node.endPosition.row);
  return start === end ? `L${start}` : `L${start}-${end}`;
}

function nodeText(node, source) {
  return source.slice(node.startIndex, node.endIndex).replace(/\s+/g, " ").trim();
}

function findNamedChild(node, type) {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === type) return child;
  }
  return null;
}

function findIdentifierName(node, source) {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (
      child.type === "identifier" ||
      child.type === "property_identifier" ||
      child.type === "type_identifier"
    ) {
      return nodeText(child, source);
    }
    if (child.type === "variable_declarator") {
      const name = findNamedChild(child, "identifier");
      if (name) return nodeText(name, source);
    }
  }
  return null;
}

function outlineLabel(node, source) {
  const name = findIdentifierName(node, source);
  const kind = node.type.replace(/_/g, " ");
  if (name) return `${kind}: ${name}`;
  const snippet = nodeText(node, source).slice(0, 60);
  return snippet ? `${kind}: ${snippet}` : kind;
}

/**
 * @param {import('web-tree-sitter').Node} node
 * @param {string} source
 * @param {number} lineOffset
 * @param {Array<{ line: string, label: string }>} out
 * @param {number} max
 */
function collectOutline(node, source, lineOffset, out, max) {
  if (out.length >= max) return;

  if (OUTLINE_NODE_TYPES.has(node.type)) {
    out.push({
      line: nodeRange(node, lineOffset),
      label: outlineLabel(node, source),
    });
    if (node.type === "class_declaration" || node.type === "class_definition") {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === "method_definition") {
          collectOutline(child, source, lineOffset, out, max);
        }
      }
      return;
    }
    return;
  }

  for (let i = 0; i < node.childCount; i++) {
    collectOutline(node.child(i), source, lineOffset, out, max);
    if (out.length >= max) return;
  }
}

/**
 * @param {import('web-tree-sitter').Node} root
 * @param {number} line 1-based workspace line
 * @param {number} lineOffset
 */
function findNodeAtLine(root, line, lineOffset) {
  const targetRow = line - lineOffset - 1;
  if (targetRow < 0) return root;

  let best = root;
  let bestSpan = root.endPosition.row - root.startPosition.row;

  function walk(node) {
    const start = node.startPosition.row;
    const end = node.endPosition.row;
    if (targetRow < start || targetRow > end) return;
    const span = end - start;
    if (span <= bestSpan) {
      best = node;
      bestSpan = span;
    }
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }

  walk(root);
  return best;
}

/**
 * @param {import('web-tree-sitter').Node} node
 * @param {string} source
 * @param {number} lineOffset
 * @param {number} depth
 * @param {number} maxDepth
 * @param {{ count: number }} budget
 * @param {number} maxNodes
 * @param {string} indent
 * @param {string[]} lines
 */
function formatSubtree(
  node,
  source,
  lineOffset,
  depth,
  maxDepth,
  budget,
  maxNodes,
  indent,
  lines,
) {
  if (budget.count >= maxNodes || depth > maxDepth) return;
  budget.count += 1;

  const name = findIdentifierName(node, source);
  const leafTypes = new Set(["identifier", "property_identifier", "string", "number", "true", "false", "null", "undefined"]);
  let header = `${node.type}`;
  if (name) header += `: ${name}`;
  header += ` [${nodeRange(node, lineOffset)}]`;

  if (leafTypes.has(node.type) || node.childCount === 0) {
    const literal = nodeText(node, source);
    if (literal && !name) header += `: ${literal}`;
    lines.push(`${indent}${header}`);
    return;
  }

  lines.push(`${indent}${header}`);
  const childIndent = `${indent}  `;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child || child.type === "ERROR" || child.isMissing()) continue;
    if (child.type === "comment") continue;
    formatSubtree(
      child,
      source,
      lineOffset,
      depth + 1,
      maxDepth,
      budget,
      maxNodes,
      childIndent,
      lines,
    );
    if (budget.count >= maxNodes) {
      lines.push(`${childIndent}… (truncated)`);
      break;
    }
  }
}

/**
 * @param {import('web-tree-sitter').Node} node
 * @param {string} symbol
 * @param {string} source
 * @param {number} lineOffset
 * @param {{ definitions: object[], references: object[] }} acc
 * @param {number} max
 */
function collectSymbolMatches(node, symbol, source, lineOffset, acc, max) {
  if (acc.definitions.length + acc.references.length >= max) return;

  const text = nodeText(node, source);
  const isId =
    node.type === "identifier" ||
    node.type === "property_identifier" ||
    node.type === "type_identifier";

  if (isId && text === symbol) {
    const row = absLine(lineOffset, node.startPosition.row);
    const parent = node.parent;
    const entry = { line: row, column: node.startPosition.column + 1, context: parent?.type ?? "" };
    if (parent && DEFINITION_PARENT_TYPES.has(parent.type)) {
      const inDecl =
        parent.type === "variable_declarator"
          ? findNamedChild(parent, "identifier") === node
          : parent.type.includes("declaration") ||
            parent.type.includes("definition");
      if (inDecl) {
        acc.definitions.push(entry);
        return;
      }
    }
    acc.references.push(entry);
  }

  for (let i = 0; i < node.childCount; i++) {
    collectSymbolMatches(node.child(i), symbol, source, lineOffset, acc, max);
  }
}

/**
 * @param {string} filePath
 * @param {string} content
 * @param {{ mode?: string, line?: number, symbol?: string, depth?: number, max_nodes?: number }} opts
 */
export async function inspectAst(filePath, content, opts = {}) {
  const mode = String(opts.mode ?? "outline").toLowerCase();
  const maxNodes = Math.min(
    Math.max(Number(opts.max_nodes ?? config.astInspect.maxNodes), 10),
    200,
  );
  const maxDepth = Math.min(
    Math.max(Number(opts.depth ?? config.astInspect.maxDepth), 1),
    12,
  );
  const maxOutline = config.astInspect.maxOutlineSymbols;

  const parsed = await parseSourceFile(filePath, content);
  if (parsed.error && !parsed.root) {
    return {
      ok: false,
      grammar: parsed.grammar,
      message: parsed.error,
    };
  }

  const { root, text, lineOffset, grammar } = parsed;
  if (!root) {
    return { ok: false, grammar, message: parsed.error ?? "Parse produced no tree" };
  }

  const header = `inspect_ast: ${filePath} (${grammar ?? "unknown"})`;

  if (mode === "outline") {
    const symbols = [];
    collectOutline(root, text, lineOffset, symbols, maxOutline);
    const lines = [
      header,
      `mode: outline (${symbols.length} symbol(s))`,
      "",
      ...symbols.map((s) => `${s.line}  ${s.label}`),
    ];
    if (!symbols.length) {
      lines.push("(no top-level symbols — try mode=subtree with a line number)");
    }
    return { ok: true, grammar, message: lines.join("\n"), symbolCount: symbols.length };
  }

  if (mode === "subtree") {
    const line = Number(opts.line ?? 1);
    const node = findNodeAtLine(root, line, lineOffset);
    const out = [];
    formatSubtree(node, text, lineOffset, 0, maxDepth, { count: 0 }, maxNodes, "", out);
    return {
      ok: true,
      grammar,
      message: [header, `mode: subtree @ line ${line}`, "", ...out].join("\n"),
    };
  }

  if (mode === "symbol") {
    const symbol = String(opts.symbol ?? "").trim();
    if (!symbol) {
      return { ok: false, grammar, message: `${header}\nmode: symbol requires "symbol" argument` };
    }
    const acc = { definitions: [], references: [] };
    collectSymbolMatches(root, symbol, text, lineOffset, acc, maxNodes);
    const lines = [
      header,
      `mode: symbol "${symbol}"`,
      "",
      `definitions (${acc.definitions.length}):`,
      ...acc.definitions.map(
        (d) => `  L${d.line}:${d.column} (${d.context})`,
      ),
      `references (${acc.references.length}):`,
      ...acc.references.slice(0, 40).map(
        (r) => `  L${r.line}:${r.column} (${r.context})`,
      ),
    ];
    if (acc.references.length > 40) {
      lines.push(`  … and ${acc.references.length - 40} more references`);
    }
    return {
      ok: true,
      grammar,
      message: lines.join("\n"),
      symbolCount: acc.definitions.length + acc.references.length,
    };
  }

  return {
    ok: false,
    grammar,
    message: `${header}\nUnknown mode "${mode}" — use outline, subtree, or symbol`,
  };
}
