import { config } from "./config.js";
import { astSupportedForPath } from "./codeCheck/ast/parse.js";
import { isPlanTodoFilePath } from "./planFreeze.js";
import { isSuccessfulToolResult, getWrittenPaths } from "./verification.js";

export function normalizeFilePath(p) {
  return String(p ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

function pathMatches(a, b) {
  const na = normalizeFilePath(a);
  const nb = normalizeFilePath(b);
  if (!na || !nb) return false;
  return na === nb || na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`);
}

function lastSuccessfulToolIndex(toolEvents, toolName, pathArg) {
  let last = -1;
  for (let i = 0; i < toolEvents.length; i++) {
    const call = toolEvents[i];
    if (call.type !== "tool_call" || call.name !== toolName) continue;
    const p = call.args?.path;
    if (!pathMatches(p, pathArg)) continue;
    const result = toolEvents[i + 1];
    if (isSuccessfulToolResult(result)) last = i;
  }
  return last;
}

export function hadInspectAst(toolEvents, filePath) {
  return lastSuccessfulToolIndex(toolEvents, "inspect_ast", filePath) >= 0;
}

export function hadReadFile(toolEvents, filePath) {
  return lastSuccessfulToolIndex(toolEvents, "read_file", filePath) >= 0;
}

/** Post-write confirmation read — allow without prior inspect_ast. */
export function isMandatoryReadBack(toolEvents, filePath) {
  const written = getWrittenPaths(toolEvents);
  if (!written.some((w) => pathMatches(w, filePath))) return false;

  let lastWriteIndex = -1;
  for (let i = 0; i < toolEvents.length; i++) {
    const e = toolEvents[i];
    if (e.type !== "tool_call" || (e.name !== "write_file" && e.name !== "search_replace")) {
      continue;
    }
    const p = e.args?.path ?? e.args?.target_file;
    if (!pathMatches(p, filePath)) continue;
    const result = toolEvents[i + 1];
    if (isSuccessfulToolResult(result)) lastWriteIndex = i;
  }
  if (lastWriteIndex < 0) return false;

  for (let i = lastWriteIndex + 1; i < toolEvents.length; i++) {
    const e = toolEvents[i];
    if (e.type === "tool_call" && e.name === "read_file") {
      const p = e.args?.path;
      if (pathMatches(p, filePath)) {
        const result = toolEvents[i + 1];
        if (isSuccessfulToolResult(result)) return false;
      }
    }
  }
  return true;
}

/**
 * Block read_file until inspect_ast ran on this path (all file sizes).
 * @param {boolean} [opts.codingTurn]
 */
export function shouldGateReadFile(toolEvents, filePath, opts = {}) {
  if (!config.astReadGate.enabled) return false;
  if (opts.codingTurn === false) return false;

  const path = normalizeFilePath(filePath);
  if (!path) return false;
  if (isPlanTodoFilePath(path)) return false;
  if (!astSupportedForPath(path)) return false;
  if (hadInspectAst(toolEvents, path)) return false;
  if (isMandatoryReadBack(toolEvents, path)) return false;

  return true;
}

export function pathsNeedingInspectAst(toolEvents, paths, opts = {}) {
  const list = (Array.isArray(paths) ? paths : [paths]).map(normalizeFilePath).filter(Boolean);
  return list.filter((p) => shouldGateReadFile(toolEvents, p, opts));
}

export function readRedirectInspectArgs(filePath, readArgs = {}) {
  const path = normalizeFilePath(filePath);
  const offset = Number(readArgs.offset ?? 0);
  if (Number.isFinite(offset) && offset > 0) {
    return { path, mode: "subtree", line: offset + 1 };
  }
  return { path, mode: "outline" };
}

export function buildReadRedirectMessage(filePath, originalTool = "read_file") {
  return (
    `AST-first policy: server redirected ${originalTool} on "${filePath}" → inspect_ast.\n` +
    `Use the structure below first. Call read_file when you need exact source text for edits (full file or offset/limit on huge files).`
  );
}

export function buildReadFileGateMessage(filePath) {
  return (
    `Blocked read_file: call inspect_ast on "${filePath}" first (mode=outline, subtree, or symbol).\n` +
    `AST inspection summarizes structure without loading the whole file into context. ` +
    `Use read_file when you need exact source text (e.g. before search_replace); ` +
    `full file by default, or offset/limit after inspect_ast locates lines in huge files.`
  );
}

/**
 * When the model calls read_file/read_files without prior inspect_ast, redirect to inspect_ast.
 * @returns {{ from: string, path: string, inspectArgs: object, message: string } | null}
 */
export function detectAstReadRedirect(toolName, args, toolEvents, opts = {}) {
  if (!config.astReadGate.enabled) return null;

  if (toolName === "read_file") {
    const path = normalizeFilePath(args?.path);
    if (!shouldGateReadFile(toolEvents, path, opts)) return null;
    return {
      from: "read_file",
      path,
      inspectArgs: readRedirectInspectArgs(path, args),
      message: buildReadRedirectMessage(path, "read_file"),
    };
  }

  if (toolName === "read_files") {
    const paths = (Array.isArray(args?.paths) ? args.paths : [])
      .map(normalizeFilePath)
      .filter(Boolean);
    const blocked = pathsNeedingInspectAst(toolEvents, paths, opts);
    if (!blocked.length) return null;
    const path = blocked[0];
    const extra =
      blocked.length > 1
        ? `\n${blocked.length - 1} other path(s) in read_files also need inspect_ast before batch read.`
        : "";
    return {
      from: "read_files",
      path,
      inspectArgs: { path, mode: "outline" },
      message: buildReadRedirectMessage(path, "read_files") + extra,
    };
  }

  return null;
}
