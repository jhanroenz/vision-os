import { config } from "./config.js";

/** @type {Record<string, { when?: string, never?: string, onBlocked?: string }>} */
const GUIDANCE = {
  mark_plan_step: {
    when:
      "After step work is proven — or write_file SKIP (already exists). Plan auto-advances on write_file SUCCESS.",
    never:
      'Repeat without new tool output. Exact JSON: {"step_id":"1","status":"done"}.',
    onBlocked:
      "Run write_file/search_replace first, or mark done after SKIP — do not loop mark_plan_step.",
  },
  update_task_plan: {
    when: "Before multi-step coding — mirror acceptance criteria; final step = verify.",
    never: "Replan during frozen execute (use mark_plan_step).",
  },
  write_file: {
    when: "Create/overwrite files. Parent dirs auto-created.",
    never: "Retry after STATUS: SKIP (already exists) — use search_replace or mark_plan_step done.",
    onBlocked: "inspect_ast or inspect_codebase first if path unknown.",
  },
  search_replace: {
    when: "Small edits to existing files.",
    never: "Without search_files hit and exact old_string match.",
  },
  read_file: {
    when: "Exact source for search_replace — after inspect_ast if structure known. Full file by default.",
    never: "Re-read to confirm when AST already answers the question.",
  },
  read_files: { when: "Batch read up to 10 paths — full contents by default." },
  inspect_ast: {
    when: "First on code files — outline/subtree/symbol before read_file.",
    never: "read_file to confirm when AST already answers the question.",
  },
  inspect_codebase: {
    when: "Detect project root and layout before writes.",
  },
  detect_stack: { when: "Manifest scan for languages, frameworks, monorepo layout." },
  search_files: {
    when: "Resolve exact paths before search_replace or delete_file.",
  },
  grep_code: { when: "Regex search for symbols/strings in codebase." },
  glob_files: { when: "Find files by glob pattern." },
  semantic_search: { when: "Natural-language concept search in repo." },
  list_directory: { when: "List folder contents when paths unknown." },
  check_syntax: {
    when: "After every write_file on code files.",
    onBlocked: "search_replace/write_file the reported line, then re-run.",
  },
  read_lints: { when: "Project eslint/tsc/ruff on a path." },
  run_check: {
    when: "Named build/lint/test with structured pass/fail (preferred over run_bash).",
  },
  run_bash: {
    when: "npm install, one-off shell commands — non-interactive only.",
    never: "npm run dev or chained install&&dev — blocked; use run_check/verify_project.",
    onBlocked: "Split install from dev; verify with build scripts.",
  },
  verify_project: {
    when: "After edits — pass project folder path (not workspace root).",
    onBlocked: "Fix FAIL output with search_replace, then re-verify.",
  },
  web_search: {
    when:
      "When unsure about versions, APIs, or best practices — training data may be stale. Once per coding turn.",
    never: "Retry in the same turn after one attempt.",
  },
  remember: { when: "Jan asks to save a preference or fact." },
  recall_brain: { when: "Look up saved memory/skills." },
  learn_skill: { when: "Durable workflow Jan wants reused." },
  apply_template: { when: "Copy bundled UI templates into project dir." },
  delete_file: { when: "Remove stray files — search_files first." },
  cleanup_stray_paths: { when: "Remove stray src/ at workspace root." },
};

export function getToolGuidance(name) {
  return GUIDANCE[String(name ?? "")] ?? null;
}

export function formatToolGuidanceLine(name) {
  if (config.agent?.toolGuidanceEnabled === false) return "";

  const g = getToolGuidance(name);
  if (!g) return "";

  const parts = [];
  if (g.when) parts.push(`When: ${g.when}`);
  if (g.never) parts.push(`Never: ${g.never}`);
  else if (g.onBlocked) parts.push(`If blocked: ${g.onBlocked}`);
  return parts.slice(0, 2).join(" ");
}

export function formatToolPlaybookBlock(toolNames) {
  const names = [...(toolNames ?? [])];
  if (!names.length) return "";

  const lines = ["Tool playbooks (quick reference):"];
  for (const name of names) {
    const line = formatToolGuidanceLine(name);
    if (line) lines.push(`- ${name}: ${line}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}
