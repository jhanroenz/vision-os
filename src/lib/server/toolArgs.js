import { normalizeUpdateTaskPlanArgs } from "./taskPlanNormalize.js";

const PLAN_STEP_STATUSES = new Set(["pending", "in_progress", "done", "skipped"]);

const STATUS_SYNONYMS = {
  complete: "done",
  completed: "done",
  finished: "done",
  finish: "done",
  skip: "skipped",
  skipped: "skipped",
  start: "in_progress",
  progress: "in_progress",
  inprogress: "in_progress",
  pending: "pending",
  done: "done",
};

function stripCodeFence(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
}

function parseJsonMaybeTwice(text) {
  let parsed = JSON.parse(text);
  if (typeof parsed === "string") {
    parsed = JSON.parse(parsed);
  }
  return parsed;
}

function extractBalancedJsonObject(text, startIdx) {
  const braceStart = text.indexOf("{", startIdx);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = braceStart; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(braceStart, i + 1);
      }
    }
  }

  return null;
}

function unescapeJsonString(raw) {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function extractQuotedField(text, field) {
  const marker = `"${field}"`;
  const label = text.indexOf(marker);
  if (label === -1) return null;

  const colon = text.indexOf(":", label + marker.length);
  if (colon === -1) return null;

  let i = colon + 1;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== '"') return null;

  i++;
  let raw = "";
  let escape = false;

  for (; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      raw += ch;
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') break;
    raw += ch;
  }

  return unescapeJsonString(raw);
}

function fallbackToolArgs(name, text) {
  switch (name) {
    case "write_file": {
      const path = extractQuotedField(text, "path");
      if (!path) return {};

      const marker = text.match(/"content"\s*:\s*"/);
      if (!marker) return { path };

      const start = marker.index + marker[0].length;
      const end = text.lastIndexOf('"}');
      const raw =
        end > start ? text.slice(start, end) : text.slice(start);
      return { path, content: unescapeJsonString(raw) };
    }
    case "read_file": {
      const path = extractQuotedField(text, "path");
      return path ? { path } : {};
    }
    case "search_replace": {
      const path = extractQuotedField(text, "path");
      const old_string = extractQuotedField(text, "old_string");
      const new_string = extractQuotedField(text, "new_string");
      const out = {};
      if (path) out.path = path;
      if (old_string) out.old_string = old_string;
      if (new_string !== undefined) out.new_string = new_string;
      return out;
    }
    case "list_directory": {
      const path = extractQuotedField(text, "path");
      return path ? { path } : {};
    }
    case "run_bash": {
      const command = extractQuotedField(text, "command");
      const cwd = extractQuotedField(text, "cwd");
      const out = {};
      if (command) out.command = command;
      if (cwd) out.cwd = cwd;
      return out;
    }
    case "web_search": {
      const query = extractQuotedField(text, "query");
      return query ? { query } : {};
    }
    case "remember": {
      const title = extractQuotedField(text, "title");
      const content = extractQuotedField(text, "content");
      const project = extractQuotedField(text, "project");
      const out = {};
      if (title) out.title = title;
      if (content) out.content = content;
      if (project) out.project = project;
      return out;
    }
    case "recall_brain": {
      const query = extractQuotedField(text, "query");
      const type = extractQuotedField(text, "type");
      const project = extractQuotedField(text, "project");
      const out = {};
      if (query) out.query = query;
      if (type) out.type = type;
      if (project) out.project = project;
      return out;
    }
    case "learn_skill": {
      const name = extractQuotedField(text, "name");
      const description = extractQuotedField(text, "description");
      const instructions = extractQuotedField(text, "instructions");
      const project = extractQuotedField(text, "project");
      const out = {};
      if (name) out.name = name;
      if (description) out.description = description;
      if (instructions) out.instructions = instructions;
      if (project) out.project = project;
      return out;
    }
    case "grep_code": {
      const pattern = extractQuotedField(text, "pattern");
      const path = extractQuotedField(text, "path");
      const glob = extractQuotedField(text, "glob");
      const out = {};
      if (pattern) out.pattern = pattern;
      if (path) out.path = path;
      if (glob) out.glob = glob;
      return out;
    }
    case "glob_files": {
      const pattern = extractQuotedField(text, "pattern");
      const path = extractQuotedField(text, "path");
      const out = {};
      if (pattern) out.pattern = pattern;
      if (path) out.path = path;
      return out;
    }
    case "semantic_search": {
      const query = extractQuotedField(text, "query");
      const path = extractQuotedField(text, "path");
      const out = {};
      if (query) out.query = query;
      if (path) out.path = path;
      return out;
    }
    case "inspect_codebase":
    case "detect_stack": {
      const path = extractQuotedField(text, "path");
      return path ? { path } : {};
    }
    case "verify_project": {
      const path = extractQuotedField(text, "path");
      const checks = extractQuotedField(text, "checks");
      const out = {};
      if (path) out.path = path;
      if (checks) out.checks = checks;
      return out;
    }
    case "inspect_ast": {
      const filePath = extractQuotedField(text, "path");
      const mode = extractQuotedField(text, "mode");
      const symbol = extractQuotedField(text, "symbol");
      const out = {};
      if (filePath) out.path = filePath;
      if (mode) out.mode = mode;
      if (symbol) out.symbol = symbol;
      return out;
    }
    case "check_syntax": {
      const filePath = extractQuotedField(text, "path");
      return filePath ? { path: filePath } : {};
    }
    case "read_lints": {
      const filePath = extractQuotedField(text, "path");
      return filePath ? { path: filePath } : {};
    }
    case "run_check": {
      const command = extractQuotedField(text, "command");
      const label = extractQuotedField(text, "label");
      const cwd = extractQuotedField(text, "cwd");
      const out = {};
      if (command) out.command = command;
      if (label) out.label = label;
      if (cwd) out.cwd = cwd;
      return out;
    }
    case "delete_file": {
      const filePath = extractQuotedField(text, "path");
      return filePath ? { path: filePath } : {};
    }
    case "read_files": {
      return {};
    }
    case "apply_template": {
      const template = extractQuotedField(text, "template");
      const projectDir = extractQuotedField(text, "projectDir");
      const out = {};
      if (template) out.template = template;
      if (projectDir) out.projectDir = projectDir;
      return out;
    }
    case "mark_plan_step": {
      const step_id =
        extractQuotedField(text, "step_id") ??
        extractQuotedField(text, "step") ??
        extractQuotedField(text, "id");
      const status =
        extractQuotedField(text, "status") ?? extractQuotedField(text, "state");
      const out = {};
      if (step_id) out.step_id = step_id;
      if (status) out.status = status;
      return normalizeMarkPlanStepArgs(out);
    }
    case "update_task_plan": {
      const title = extractQuotedField(text, "title");
      const steps = [];
      const stepBlocks = text.matchAll(
        /\{[^{}]*"label"\s*:\s*"([^"]+)"[^{}]*\}/g,
      );
      for (const match of stepBlocks) {
        steps.push({
          id: String(steps.length + 1),
          label: match[1],
          status: "pending",
        });
      }
      if (steps.length === 0) {
        const labels = text.matchAll(/"label"\s*:\s*"([^"]+)"/g);
        for (const match of labels) {
          steps.push({
            id: String(steps.length + 1),
            label: match[1],
            status: "pending",
          });
        }
      }
      const out = {};
      if (title) out.title = title;
      if (steps.length) out.steps = steps;
      return normalizeUpdateTaskPlanArgs(out) ?? out;
    }
    default:
      return {};
  }
}

function unwrapToolPayload(content) {
  let text = stripCodeFence(content);
  try {
    const parsed = parseJsonMaybeTwice(text);
    if (typeof parsed === "string") text = parsed;
    else if (parsed?.tool) return parsed;
  } catch {
    if (text.startsWith('"') && text.endsWith('"')) {
      try {
        text = JSON.parse(text);
      } catch {
        // keep original text for fallback parsing
      }
    }
  }
  return text;
}

function coerceNestedToolArgsString(toolName, raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (toolName === "update_task_plan") {
      if (Array.isArray(parsed)) return { steps: parsed };
      return typeof parsed === "object" && parsed ? parsed : {};
    }
    if (toolName === "run_bash") {
      if (typeof parsed === "string") return { command: parsed };
      return typeof parsed === "object" && parsed ? parsed : { command: trimmed };
    }
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    if (toolName === "run_bash") return { command: trimmed };
    if (toolName === "update_task_plan") {
      return normalizeUpdateTaskPlanArgs({ steps: trimmed }) ?? { steps: trimmed };
    }
    return {};
  }
}

/** Model sometimes nests {"tool":"update_task_plan",...} inside run_bash args. */
export function unwrapNestedToolRequest(toolRequest) {
  if (!toolRequest?.args || typeof toolRequest.args !== "object") {
    return toolRequest;
  }

  const nestedName = toolRequest.args.tool ?? toolRequest.args.name;
  if (typeof nestedName !== "string" || nestedName === toolRequest.name) {
    return toolRequest;
  }

  let nestedArgs =
    toolRequest.args.args ?? toolRequest.args.arguments ?? toolRequest.args.parameters ?? {};
  if (typeof nestedArgs === "string") {
    nestedArgs = coerceNestedToolArgsString(nestedName, nestedArgs);
  }

  const nestedHasPayload =
    (nestedArgs &&
      typeof nestedArgs === "object" &&
      Object.keys(nestedArgs).length > 0) ||
    typeof toolRequest.args.args === "string" ||
    typeof toolRequest.args.arguments === "string";

  if (!nestedHasPayload) {
    return toolRequest;
  }

  return {
    ...toolRequest,
    name: nestedName,
    args: nestedArgs ?? {},
  };
}

export function parseReactToolCall(content) {
  if (!content) return null;

  const payload = unwrapToolPayload(content);
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);

  if (typeof payload === "object" && payload?.tool) {
    let args = payload.args ?? {};
    if (
      args &&
      typeof args === "object" &&
      typeof args.tool === "string" &&
      args.tool !== payload.tool
    ) {
      let inner = args.args ?? args.arguments ?? {};
      if (typeof inner === "string") {
        inner = coerceNestedToolArgsString(args.tool, inner);
      }
      return { name: args.tool, args: inner ?? {} };
    }
    // Coerce string args at parse time (model often emits "args": "shell cmd")
    if (typeof args === "string") {
      if (payload.tool === "run_bash") args = { command: args };
      else if (payload.tool === "web_search") args = { query: args };
      else if (
        payload.tool === "inspect_codebase" ||
        payload.tool === "detect_stack" ||
        payload.tool === "inspect_ast" ||
        payload.tool === "check_syntax"
      ) {
        args = { path: args };
      }
    }
    return { name: payload.tool, args };
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed?.tool && typeof parsed.tool === "string") {
      return {
        name: parsed.tool,
        args: parsed.args ?? {},
      };
    }
  } catch {
    // fall through to partial extraction
  }

  const toolMatch = text.match(/"tool"\s*:\s*"([a-zA-Z0-9_]+)"/);
  if (!toolMatch) return null;

  const name = toolMatch[1];
  const argsIdx = text.indexOf('"args"');
  if (argsIdx === -1) {
    return { name, args: fallbackToolArgs(name, text) };
  }

  const argsJson = extractBalancedJsonObject(text, argsIdx);
  if (argsJson) {
    try {
      return { name, args: JSON.parse(argsJson) };
    } catch {
      // Gemma often emits invalid JSON for large write_file content
    }
  }

  return { name, args: fallbackToolArgs(name, text) };
}

function coerceNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return value;
}

function firstDefined(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

export function normalizeMarkPlanStepArgs(args) {
  if (args === null || args === undefined) return {};
  const copy = typeof args === "object" ? { ...args } : {};

  const stepRaw = firstDefined(copy, [
    "step_id",
    "stepId",
    "step",
    "id",
    "step_number",
    "stepNumber",
  ]);
  const statusRaw = firstDefined(copy, ["status", "state"]);

  const out = {};
  if (stepRaw !== undefined && stepRaw !== null && String(stepRaw).trim() !== "") {
    out.step_id = String(stepRaw).trim();
  }
  if (statusRaw !== undefined && statusRaw !== null && String(statusRaw).trim() !== "") {
    const key = String(statusRaw).trim().toLowerCase().replace(/\s+/g, "_");
    const mapped = STATUS_SYNONYMS[key] ?? key;
    if (PLAN_STEP_STATUSES.has(mapped)) {
      out.status = mapped;
    } else {
      out.status = String(statusRaw).trim();
    }
  }
  return out;
}

export function sanitizeToolArgs(toolName, args) {
  // A plain string is never a valid args object; pass it through to the per-tool
  // string-coercion cases below rather than crashing or silently returning {}.
  if (args === null || args === undefined) return {};
  if (typeof args !== "object" && typeof args !== "string") return {};

  const copy = typeof args === "object" ? { ...args } : {};

  switch (toolName) {
    case "write_file": {
      const path = firstDefined(copy, ["path", "file", "file_path", "filepath", "filename"]);
      const content = firstDefined(copy, ["content", "text", "body", "data", "contents"]);
      const out = {};
      if (path !== undefined) out.path = String(path);
      if (content !== undefined) {
        out.content = typeof content === "string" ? content : JSON.stringify(content);
      }
      return out;
    }
    case "read_file": {
      const path = firstDefined(copy, ["path", "file", "file_path", "filepath", "filename"]);
      const out = {};
      if (path !== undefined) out.path = String(path);
      if (copy.offset !== undefined) out.offset = coerceNumber(copy.offset);
      if (copy.limit !== undefined) out.limit = coerceNumber(copy.limit);
      return out;
    }
    case "search_replace": {
      const path = firstDefined(copy, ["path", "file", "file_path", "filepath", "filename"]);
      const old_string = firstDefined(copy, ["old_string", "old", "search", "find"]);
      const new_string = firstDefined(copy, ["new_string", "new", "replace", "replacement"]);
      const out = {};
      if (path !== undefined) out.path = String(path);
      if (old_string !== undefined) out.old_string = String(old_string);
      if (new_string !== undefined) out.new_string = String(new_string);
      if (copy.replace_all !== undefined) out.replace_all = Boolean(copy.replace_all);
      return out;
    }
    case "list_directory": {
      const path = firstDefined(copy, ["path", "dir", "directory", "folder"]);
      return path !== undefined ? { path: String(path) } : {};
    }
    case "run_bash": {
      // Model sometimes emits "args": "shell command string" instead of {"command": "..."}
      if (typeof args === "string") return { command: args };
      const command = firstDefined(copy, ["command", "cmd", "bash", "script"]);
      const out = {};
      if (command !== undefined) out.command = String(command);
      if (copy.timeout !== undefined) out.timeout = coerceNumber(copy.timeout);
      if (copy.cwd !== undefined) out.cwd = String(copy.cwd);
      return out;
    }
    case "web_search": {
      // Model sometimes emits "args": "query text" instead of {"query": "..."}
      if (typeof args === "string") return { query: args };
      const query = firstDefined(copy, ["query", "q", "search"]);
      const engines = firstDefined(copy, ["engines", "engine", "search_engines"]);
      const categories = firstDefined(copy, ["categories", "category"]);
      const out = {};
      if (query !== undefined) out.query = String(query);
      if (engines !== undefined) out.engines = String(engines);
      if (categories !== undefined) out.categories = String(categories);
      return out;
    }
    case "remember": {
      const title = firstDefined(copy, ["title", "name", "label"]);
      const content = firstDefined(copy, ["content", "text", "body", "detail", "details"]);
      const category = firstDefined(copy, ["category", "type"]);
      const out = {};
      if (title !== undefined) out.title = String(title);
      if (content !== undefined) out.content = String(content);
      if (category !== undefined) out.category = String(category);
      if (copy.importance !== undefined) out.importance = coerceNumber(copy.importance);
      if (copy.project !== undefined) out.project = String(copy.project);
      return out;
    }
    case "learn_skill": {
      const name = firstDefined(copy, ["name", "skill", "title"]);
      const description = firstDefined(copy, ["description", "summary", "desc"]);
      const instructions = firstDefined(copy, ["instructions", "steps", "content", "text"]);
      const out = {};
      if (name !== undefined) out.name = String(name);
      if (description !== undefined) out.description = String(description);
      if (instructions !== undefined) out.instructions = String(instructions);
      if (copy.project !== undefined) out.project = String(copy.project);
      return out;
    }
    case "recall_brain": {
      const query = firstDefined(copy, ["query", "q", "search", "topic"]);
      const type = firstDefined(copy, ["type", "kind"]);
      const project = firstDefined(copy, ["project", "scope"]);
      const out = {};
      if (query !== undefined) out.query = String(query);
      if (type !== undefined) out.type = String(type);
      if (copy.limit !== undefined) out.limit = coerceNumber(copy.limit);
      if (project !== undefined) out.project = String(project);
      return out;
    }
    case "grep_code": {
      const out = {};
      const pattern = firstDefined(copy, ["pattern", "query", "search", "regex"]);
      const path = firstDefined(copy, ["path", "dir", "directory"]);
      if (pattern !== undefined) out.pattern = String(pattern);
      if (path !== undefined) out.path = String(path);
      if (copy.glob !== undefined) out.glob = String(copy.glob);
      if (copy.case_insensitive !== undefined) {
        out.case_insensitive = Boolean(copy.case_insensitive);
      }
      if (copy.max_results !== undefined) out.max_results = coerceNumber(copy.max_results);
      return out;
    }
    case "glob_files": {
      const out = {};
      const pattern = firstDefined(copy, ["pattern", "glob", "query"]);
      const path = firstDefined(copy, ["path", "dir", "directory"]);
      if (pattern !== undefined) out.pattern = String(pattern);
      if (path !== undefined) out.path = String(path);
      if (copy.max_results !== undefined) out.max_results = coerceNumber(copy.max_results);
      return out;
    }
    case "search_files": {
      const out = {};
      const query = firstDefined(copy, ["query", "q", "name", "pattern", "file"]);
      const path = firstDefined(copy, ["path", "dir", "directory", "root"]);
      if (query !== undefined) out.query = String(query);
      if (path !== undefined) out.path = String(path);
      if (copy.max_results !== undefined) out.max_results = coerceNumber(copy.max_results);
      return out;
    }
    case "semantic_search": {
      const out = {};
      const query = firstDefined(copy, ["query", "q", "search", "question"]);
      const path = firstDefined(copy, ["path", "dir", "directory"]);
      if (query !== undefined) out.query = String(query);
      if (path !== undefined) out.path = String(path);
      if (copy.limit !== undefined) out.limit = coerceNumber(copy.limit);
      if (copy.reindex !== undefined) out.reindex = Boolean(copy.reindex);
      return out;
    }
    case "inspect_codebase":
    case "detect_stack": {
      // Model sometimes emits "args": "path/to/dir" instead of {"path": "..."}
      if (typeof args === "string") return { path: args };
      const path = firstDefined(copy, ["path", "dir", "directory"]);
      return path !== undefined ? { path: String(path) } : {};
    }
    case "verify_project": {
      const out = {};
      const path = firstDefined(copy, ["path", "dir", "project", "projectDir"]);
      if (path !== undefined) out.path = String(path);
      if (copy.checks !== undefined) out.checks = String(copy.checks);
      return out;
    }
    case "inspect_ast": {
      const out = {};
      const filePath = firstDefined(copy, ["path", "file"]);
      if (filePath !== undefined) out.path = String(filePath);
      if (copy.mode !== undefined) out.mode = String(copy.mode);
      if (copy.symbol !== undefined) out.symbol = String(copy.symbol);
      if (copy.line !== undefined) out.line = coerceNumber(copy.line);
      if (copy.depth !== undefined) out.depth = coerceNumber(copy.depth);
      if (copy.max_nodes !== undefined) out.max_nodes = coerceNumber(copy.max_nodes);
      return out;
    }
    case "check_syntax": {
      const out = {};
      const filePath = firstDefined(copy, ["path", "file"]);
      if (filePath !== undefined) out.path = String(filePath);
      return out;
    }
    case "read_lints": {
      const out = {};
      const filePath = firstDefined(copy, ["path", "file", "dir"]);
      if (filePath !== undefined) out.path = String(filePath);
      return out;
    }
    case "run_check": {
      const command = firstDefined(copy, ["command", "cmd"]);
      const label = firstDefined(copy, ["label", "name"]);
      const out = {};
      if (command !== undefined) out.command = String(command);
      if (label !== undefined) out.label = String(label);
      if (copy.cwd !== undefined) out.cwd = String(copy.cwd);
      if (copy.timeout !== undefined) out.timeout = coerceNumber(copy.timeout);
      return out;
    }
    case "delete_file": {
      const filePath = firstDefined(copy, ["path", "file"]);
      return filePath !== undefined ? { path: String(filePath) } : {};
    }
    case "read_files": {
      const out = {};
      if (Array.isArray(copy.paths)) {
        out.paths = copy.paths.map(String);
      } else if (copy.path !== undefined) {
        out.paths = [String(copy.path)];
      }
      if (copy.limit !== undefined) out.limit = coerceNumber(copy.limit);
      return out;
    }
    case "apply_template": {
      const out = {};
      if (copy.template !== undefined) out.template = String(copy.template);
      if (copy.projectDir !== undefined) out.projectDir = String(copy.projectDir);
      return out;
    }
    case "update_task_plan": {
      let source = { ...copy };
      if (typeof source.args === "string") {
        source = coerceNestedToolArgsString("update_task_plan", source.args);
      }
      if (typeof source.steps === "string") {
        try {
          const parsed = JSON.parse(source.steps);
          source.steps = Array.isArray(parsed) ? parsed : parsed?.steps ?? parsed;
        } catch {
          // normalizeStepsInput handles multiline strings
        }
      }
      const normalized = normalizeUpdateTaskPlanArgs(source);
      if (normalized) return normalized;
      const out = {};
      if (source.title !== undefined) out.title = String(source.title);
      if (Array.isArray(source.steps)) out.steps = source.steps;
      return out;
    }
    case "mark_plan_step":
      return normalizeMarkPlanStepArgs(copy);
    default:
      return copy;
  }
}

/** When the model passes only cwd (common mkdir mistake), infer mkdir -p. */
export function inferRunBashCommand(args) {
  const command = String(args?.command ?? "").trim();
  if (command) return command;
  const cwd = String(args?.cwd ?? "").trim();
  if (cwd) return `mkdir -p ${cwd}`;
  return "";
}

export function describeToolSchema(toolName) {
  const schemas = {
    write_file: '{ "path": "relative/path", "content": "full file text" }',
    search_replace:
      '{ "path": "relative/path", "old_string": "exact text", "new_string": "replacement", "replace_all?": bool }',
    read_file: '{ "path": "relative/path", "offset?": number, "limit?": number }',
    list_directory: '{ "path?": "relative/dir" }',
    run_bash: '{ "command": "shell command", "cwd?": "dir", "timeout?": seconds }',
    web_search:
      '{ "query": "search terms", "engines?": "google|bing|brave|duckduckgo|...", "categories?": "general" }',
    remember:
      '{ "title": "short label", "content": "detail to persist", "category?": "preference|project|fact|workflow|fix", "importance?": 1-5, "project?": "portfolio|global" }',
    recall_brain:
      '{ "query": "what to look up", "type?": "memory|skill|both", "limit?": number, "project?": "portfolio|global" }',
    learn_skill:
      '{ "name": "skill name", "description": "one line", "instructions": "actionable steps", "project?": "portfolio|global" }',
    inspect_codebase: '{ "path?": "relative/dir/to/search/from" }',
    detect_stack: '{ "path?": "relative/project/folder" }',
    inspect_ast:
      '{ "path": "relative/file.ext", "mode?": "outline|subtree|symbol", "line?": number, "symbol?": string, "depth?": number, "max_nodes?": number }',
    verify_project:
      '{ "path": "project-folder-with-package.json", "checks?": "all|test|build|lint" }',
    check_syntax: '{ "path": "relative/file.ext" }',
    read_lints: '{ "path": "relative/file-or-dir" }',
    run_check:
      '{ "command": "npm run build", "label": "build", "cwd?": "project/dir", "timeout?": seconds }',
    delete_file: '{ "path": "relative/file" }',
    read_files: '{ "paths": ["a.js", "b.js"], "limit?": number }',
    cleanup_stray_paths: '{ "paths?": ["src"] }',
    grep_code:
      '{ "pattern": "regex", "path?": "dir", "glob?": "*.ts", "case_insensitive?": bool, "max_results?": number }',
    glob_files: '{ "pattern": "**/*.vue", "path?": "dir", "max_results?": number }',
    search_files:
      '{ "query": "App.vue | package.json | src/**/*.vue", "path?": "scan root", "max_results?": number }',
    semantic_search:
      '{ "query": "natural language concept", "path?": "dir", "limit?": number, "reindex?": bool }',
    apply_template: '{ "template": "template-id", "projectDir?": "relative/project/dir" }',
    update_task_plan:
      '{ "title?": "plan title", "steps": [{ "id": "1", "label": "...", "status?": "pending|in_progress|done|skipped" }] }',
    mark_plan_step:
      '{ "step_id": "1", "status": "done" } — after write SUCCESS or write SKIP (already exists); plan auto-advances on write_file',
  };
  return schemas[toolName] ?? "{}";
}
