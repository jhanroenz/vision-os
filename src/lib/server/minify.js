import { config } from "./config.js";

function truncate(text, max, label = "content") {
  if (!text || text.length <= max) return text;
  const omitted = text.length - max;
  return `${text.slice(0, max)}\n\n[${label} truncated: ${omitted} chars omitted]`;
}

function minifyWebSearch(content) {
  try {
    const results = JSON.parse(content);
    if (!Array.isArray(results)) return truncate(content, config.minify.searchMaxChars);

    const pageMax = config.searxng?.fetchMaxChars ?? 20000;
    const trimmed = results.slice(0, config.minify.searchMaxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: truncate(r.snippet ?? "", config.minify.searchSnippetChars, "snippet"),
      ...(r.pageContent ? { pageContent: r.pageContent.slice(0, pageMax) } : {}),
    }));

    return JSON.stringify(trimmed, null, 2);
  } catch {
    return truncate(content, config.minify.searchMaxChars);
  }
}

function minifyFileRead(content) {
  if (config.minify.fileReadMaxChars === 0) return content;

  const headerMatch = content.match(/^([\s\S]*?^--- .+ ---\n)/m);
  const fileHeaderMatch = content.match(/^(=== FILE: .+ ===\n(?:=== PROJECT: .+ ===\n)?\n)/);
  const prefix = fileHeaderMatch?.[1] ?? headerMatch?.[1] ?? "";
  const body = prefix ? content.slice(prefix.length) : content;

  if (content.length <= config.minify.fileReadMaxChars) return content;

  if (body.length <= config.minify.fileReadMaxChars - prefix.length) {
    return content;
  }

  const lines = body.split("\n");
  const head = lines.slice(0, config.minify.fileReadHeadLines).join("\n");
  const tail = lines.slice(-config.minify.fileReadTailLines).join("\n");

  return (
    `${prefix}${head}\n\n[… ${lines.length - config.minify.fileReadHeadLines - config.minify.fileReadTailLines} lines omitted …]\n\n${tail}`
  );
}

function minifyBashOutput(content) {
  return truncate(content, config.minify.bashMaxChars, "bash output");
}

export function minifyToolResult(toolName, content) {
  if (!config.minify.enabled) return content;
  if (!content) return content;

  const text = typeof content === "string" ? content : JSON.stringify(content);

  switch (toolName) {
    case "web_search":
      return minifyWebSearch(text);
    case "semantic_search":
    case "grep_code":
      return truncate(text, config.minify.searchMaxChars, "search results");
    case "read_file":
    case "read_files":
    case "verify_project":
      return minifyFileRead(text);
    case "list_directory":
      return truncate(text, config.minify.listDirMaxChars, "directory listing");
    case "run_bash":
      return minifyBashOutput(text);
    case "remember":
    case "learn_skill":
    case "recall_brain":
      return truncate(text, 400, "evolution result");
    default:
      return truncate(text, config.minify.defaultMaxChars);
  }
}

export function minifyLlmMessage(message) {
  if (!config.minify.enabled || !message?.content) return message;

  const content =
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content);

  if (message.role === "assistant" && content.length > config.minify.assistantMaxChars) {
    return {
      ...message,
      content: truncate(content, config.minify.assistantMaxChars, "assistant reply"),
    };
  }

  if (message.role === "user" && content.startsWith("Tool result for ")) {
    const match = content.match(/^Tool result for ([a-z_]+):\n([\s\S]*)$/);
    if (match) {
      const [, toolName, body] = match;
      return {
        ...message,
        content: `Tool result for ${toolName}:\n${minifyToolResult(toolName, body)}`,
      };
    }
  }

  if (message.role === "tool" && content.length > config.minify.defaultMaxChars) {
    return {
      ...message,
      content: truncate(content, config.minify.defaultMaxChars, "tool result"),
    };
  }

  return message;
}

export function minifyTranscript(messages) {
  return messages.map((m) => {
    const minified = minifyLlmMessage(m);
    if (!minified.content) return minified;

    const content = messageToText(minified);
    return {
      role: minified.role,
      content: truncate(content, config.minify.transcriptMaxChars, "history"),
    };
  });
}

function messageToText(message) {
  if (!message?.content) return "";
  return typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);
}
