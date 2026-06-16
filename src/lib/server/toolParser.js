const GEMMA_TOOL_CALL_RE =
  /<\|tool_call>call:([a-zA-Z0-9_]+)\{([^}]*)\}<tool_call\|>/g;

const TOOL_CODE_RE =
  /<tool_code>([a-zA-Z0-9_]+)\{([^}]*)\}<\/tool_code>/g;

/** Gemma often emits bare tool calls without wrappers, e.g. web_search{query:<|"|>…<|"|>} */
const BARE_GEMMA_TOOL_CALL_RE =
  /(?:^|[\s\n])([a-zA-Z][a-zA-Z0-9_]*)\{([^}]+)\}/gm;

const PRINT_CALL_RE =
  /(?:print\()?([a-zA-Z0-9_]+)\(([^)]*)\)\)?/g;

export function parseGemmaArgs(raw) {
  const args = {};

  const kvRe = /([a-zA-Z_][a-zA-Z0-9_]*):<\|"\|>(.*?)<\|"\|>/g;
  let match;
  while ((match = kvRe.exec(raw)) !== null) {
    args[match[1]] = match[2];
  }

  if (Object.keys(args).length === 0 && raw.trim()) {
    const simpleKv = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*['"]([^'"]*)['"]/g;
    while ((match = simpleKv.exec(raw)) !== null) {
      args[match[1]] = match[2];
    }
  }

  if (Object.keys(args).length === 0 && raw.trim()) {
    const quotedKv = /([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    while ((match = quotedKv.exec(raw)) !== null) {
      args[match[1]] = match[2].replace(/\\"/g, '"');
    }
  }

  return args;
}

function makeToolCall(name, args) {
  return {
    id: `parsed_${crypto.randomUUID()}`,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

/** True when streamed assistant text looks like an in-progress Gemma tool call. */
export function shouldSuppressGemmaToolCallStream(accumulated) {
  const t = String(accumulated ?? "").trimStart();
  if (!t) return false;
  if (/^<\|tool_call>/i.test(t) || /^<tool_code>/i.test(t)) return true;
  if (/^[a-z_][a-z0-9_]*\{/i.test(t)) return true;
  return false;
}

export function parseToolCallsFromContent(content, knownToolNames) {
  if (!content || !knownToolNames?.size) return [];

  const calls = [];
  const seen = new Set();

  for (const [pattern, handler] of [
    [GEMMA_TOOL_CALL_RE, (m) => ({ name: m[1], args: parseGemmaArgs(m[2]) })],
    [TOOL_CODE_RE, (m) => ({ name: m[1], args: parseGemmaArgs(m[2]) })],
    [BARE_GEMMA_TOOL_CALL_RE, (m) => ({ name: m[1], args: parseGemmaArgs(m[2]) })],
    [
      PRINT_CALL_RE,
      (m) => {
        if (!knownToolNames.has(m[1])) return null;
        return { name: m[1], args: parseGemmaArgs(m[2]) };
      },
    ],
  ]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const parsed = handler(match);
      if (!parsed || !knownToolNames.has(parsed.name)) continue;

      const key = `${parsed.name}:${JSON.stringify(parsed.args)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      calls.push(makeToolCall(parsed.name, parsed.args));
    }
  }

  return calls;
}
