import { config } from "./config.js";
import { UPDATE_TASK_PLAN_SCHEMA_EXAMPLE } from "./scaffoldGuidance.js";

/** Gemma 4 E2B/E4B and E4B-CODER — small effective params, weak tool JSON without explicit anchoring. */
export function isGemmaSmallModel(model) {
  const m = String(
    model ?? config.llm.model ?? process.env.LLM_MODEL ?? "",
  ).toLowerCase();
  return /gemma-4-e[24]b|gemma.*e4b.*coder|gemma.*e2b.*cod/i.test(m);
}

export const GEMMA_TOOL_ANCHOR = `Gemma tool discipline (CRITICAL — overrides chat habits):
- Coding/agent turns: output ONLY a raw tool JSON object. No markdown fences. No HTML/JS/CSS in chat.
- FORBIDDEN in assistant text during coding: \`\`\` blocks, <!DOCTYPE, "I will", "Here is", "Let me", pasted file contents, bullet plans without a tool call.
- If Master Jan asked you to build or edit code → call a tool in this turn. Plain text is ONLY for final handoff after verify passes.

First-turn patterns (pick ONE tool, emit JSON only):
- New vanilla app (HTML/CSS/JS, no npm): ${UPDATE_TASK_PLAN_SCHEMA_EXAMPLE}
  Put index.html, style.css, and script.js at the project root (no src/ unless user asked).
- New Vue/React + Vite app: {"tool":"update_task_plan","args":{"title":"Vue todo app","steps":[{"id":"1","label":"run_bash mkdir + npm create vite@latest <dir> -- --template vue","status":"pending"},{"id":"2","label":"write_file src components and styles","status":"pending"},{"id":"3","label":"verify_project","status":"pending"}]}}
- Edit existing project: {"tool":"search_files","args":{"query":"app.js"}} then inspect_ast/read_file → search_replace or write_file
- Tool-only reply test: {"tool":"search_files","args":{"query":"auth"}}

write_file (never paste this content in chat — put it in args.content):
{"tool":"write_file","args":{"path":"my-app/index.html","content":"<!DOCTYPE html>\\n<html>...</html>"}}

run_bash (non-interactive only):
{"tool":"run_bash","args":{"command":"mkdir -p my-app && cd my-app && npm init -y","cwd":"."}}

Wrong: "I'll create index.html:" followed by HTML.
Right: {"tool":"write_file","args":{"path":"my-app/index.html","content":"..."}}`;

/** Shorter UI rules — full block overwhelms small Gemma context. */
export const GEMMA_UI_COMPACT = `UI tasks (vanilla / Vue / React):
- Use CSS variables for colors, spacing, typography — one global stylesheet first.
- Mobile-first layout; no browser-default Times/purple links.
- write_file full files; never dump HTML/CSS/JS in chat instead of write_file.`;
