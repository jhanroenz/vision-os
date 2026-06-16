/** Max chars of command output surfaced in activity UI (full text stays in LLM context). */
export const COMMAND_OUTPUT_UI_MAX = 10_240;

const STATUS_PREFIX = /^STATUS: (?:SUCCESS|FAIL|BLOCKED)\n?/m;

/**
 * @param {string} text
 * @param {number} max
 */
function cap(text, max = COMMAND_OUTPUT_UI_MAX) {
  const s = String(text ?? "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… (truncated)`;
}

/**
 * @param {string} text
 * @param {"stdout"|"stderr"} section
 */
function extractSection(text, section) {
  const marker = `${section}:\n`;
  const idx = text.indexOf(marker);
  if (idx < 0) return "";

  const start = idx + marker.length;
  const rest = text.slice(start);
  const next = rest.search(
    /\n\n(?:stdout:|stderr:|cwd:|RESULT:|OVERALL:|STATUS:)/,
  );
  return next >= 0 ? rest.slice(0, next) : rest;
}

/**
 * @param {string} toolName
 * @param {string} content
 * @param {object} [args]
 * @returns {object | null}
 */
export function parseCommandToolResult(toolName, content, args = {}) {
  const text = String(content ?? "").replace(STATUS_PREFIX, "");

  if (toolName === "run_bash") {
    const timedOut = /\(command timed out\)/i.test(text);
    const success = /RESULT:\s*SUCCESS/i.test(text) && !timedOut;
    const exitMatch =
      text.match(/RESULT:\s*(?:SUCCESS|FAILED)\s*\(exit\s+(\d+)\)/i) ??
      text.match(/exit code:\s*(\d+)/i);
    const exitCode = exitMatch ? Number(exitMatch[1]) : success ? 0 : 1;
    const cwdMatch = text.match(/^cwd:\s*(.+)$/m);
    const stdout = extractSection(text, "stdout");
    const stderr = extractSection(text, "stderr");
    const combined =
      [stdout && `stdout:\n${stdout}`, stderr && `stderr:\n${stderr}`]
        .filter(Boolean)
        .join("\n\n") || text;

    return {
      success: success && exitCode === 0,
      exitCode,
      command: String(args.command ?? "").trim(),
      cwd: String(args.cwd ?? cwdMatch?.[1]?.trim() ?? "").trim(),
      stdout: cap(stdout),
      stderr: cap(stderr),
      timedOut,
      displayOutput: cap(combined),
    };
  }

  if (toolName === "verify_project") {
    const pass = /OVERALL:\s*PASS/i.test(text);
    const fail = /OVERALL:\s*FAIL/i.test(text);
    return {
      success: pass && !fail,
      exitCode: pass && !fail ? 0 : 1,
      command: "verify_project",
      cwd: String(args.path ?? "").trim(),
      stdout: cap(text),
      stderr: "",
      timedOut: false,
      displayOutput: cap(text),
    };
  }

  if (toolName === "check_syntax") {
    const success = /RESULT:\s*SUCCESS/i.test(text);
    const failed = /RESULT:\s*FAILED/i.test(text);
    return {
      success: success && !failed,
      exitCode: success && !failed ? 0 : 1,
      command: args.path ? `check_syntax ${args.path}` : "check_syntax",
      cwd: "",
      stdout: cap(text),
      stderr: "",
      timedOut: false,
      displayOutput: cap(text),
    };
  }

  if (toolName === "run_check") {
    const timedOut = /\(command timed out\)/i.test(text);
    const success = /RESULT:\s*SUCCESS/i.test(text) && !timedOut;
    const exitMatch = text.match(/RESULT:\s*(?:SUCCESS|FAILED)\s*\(exit\s+(\d+)\)/i);
    const exitCode = exitMatch ? Number(exitMatch[1]) : success ? 0 : 1;
    const cwdMatch = text.match(/^cwd:\s*(.+)$/m);
    const labelMatch = text.match(/^label:\s*(.+)$/m);
    const stdout = extractSection(text, "stdout");
    const stderr = extractSection(text, "stderr");
    const combined =
      [stdout && `stdout:\n${stdout}`, stderr && `stderr:\n${stderr}`]
        .filter(Boolean)
        .join("\n\n") || text;

    return {
      success: success && exitCode === 0,
      exitCode,
      command: labelMatch?.[1]?.trim() || args.label || args.command || "run_check",
      cwd: String(args.cwd ?? cwdMatch?.[1]?.trim() ?? "").trim(),
      stdout: cap(stdout),
      stderr: cap(stderr),
      timedOut,
      displayOutput: cap(combined),
    };
  }

  if (toolName === "read_lints") {
    const success = /RESULT:\s*SUCCESS/i.test(text);
    const failed = /RESULT:\s*FAILED/i.test(text);
    return {
      success: success && !failed,
      exitCode: success && !failed ? 0 : 1,
      command: args.path ? `read_lints ${args.path}` : "read_lints",
      cwd: "",
      stdout: cap(text),
      stderr: "",
      timedOut: false,
      displayOutput: cap(text),
    };
  }

  return null;
}

export const COMMAND_RESULT_TOOLS = new Set([
  "run_bash",
  "verify_project",
  "check_syntax",
  "run_check",
  "read_lints",
]);
