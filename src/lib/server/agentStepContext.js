import fs from "node:fs/promises";
import { resolveSafePath, getLockedProjectRoot, getThreadCwd, getActiveProjectRoot } from "./workspace.js";
import { getCurrentPlanStep, hasValidPlan, planProgressSummary } from "./taskPlan.js";
import { getWrittenPaths, getLastVerifyResult } from "./verification.js";
import { getKnownPaths } from "./fileContext.js";
import { isAwarenessComplete } from "./workspacePreflight.js";

const lastBriefByThread = new Map();

const PATH_IN_LABEL_RE =
  /(?:^|[\s"'(])([a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)+\.[a-zA-Z0-9]+|[a-zA-Z0-9._-]+\/(?:src|lib|app)\/[a-zA-Z0-9._/-]+)/g;

function extractPathsFromStepLabel(label) {
  const paths = new Set();
  const text = String(label ?? "");
  let match;
  PATH_IN_LABEL_RE.lastIndex = 0;
  while ((match = PATH_IN_LABEL_RE.exec(text)) !== null) {
    paths.add(match[1].replace(/\\/g, "/"));
  }
  return [...paths];
}

async function pathDiskTag(relativePath) {
  try {
    const stat = await fs.stat(resolveSafePath(relativePath));
    return stat.isDirectory() ? "EXISTS (dir)" : "EXISTS (file)";
  } catch {
    return "MISSING";
  }
}

/**
 * Compact per-iteration context to ground paths, plan step ids, and disk state.
 * @returns {Promise<string|null>} brief text or null if deduped
 */
export async function buildAgentStepContextBrief(
  threadId,
  { toolEvents = [], step = 0 } = {},
) {
  if (!hasValidPlan(threadId)) return null;

  const locked = getLockedProjectRoot(threadId);
  const cwd = getThreadCwd(threadId);
  const active = getActiveProjectRoot(threadId);
  const current = getCurrentPlanStep(threadId);
  const progress = planProgressSummary(threadId) ?? "?";
  const written = getWrittenPaths(toolEvents);
  const known = getKnownPaths(threadId);
  const verify = getLastVerifyResult(toolEvents);

  const lines = [
    "[Agent step context — authoritative for this iteration]",
    locked
      ? `Locked project root: ${locked}`
      : "Locked project root: NONE — call inspect_codebase before path-scoped edits",
    `Cwd: ${cwd}${active && active !== cwd ? ` | Active project: ${active}` : ""}`,
    `Task plan: ${progress} done`,
  ];

  if (current) {
    lines.push(
      `Active step: ${current.id}. ${current.label} (${current.status})`,
      `mark_plan_step when ready: {"step_id":"${current.id}","status":"done"}`,
    );

    const labelPaths = extractPathsFromStepLabel(current.label);
    if (labelPaths.length) {
      const diskHints = [];
      for (const p of labelPaths.slice(0, 4)) {
        const resolved =
          locked && !p.startsWith(`${locked}/`) && !p.includes("/")
            ? `${locked}/${p}`
            : p;
        diskHints.push(`  ${resolved}: ${await pathDiskTag(resolved)}`);
      }
      lines.push("Step path hints:", ...diskHints);
    }
  }

  lines.push(
    `Written this turn: ${written.length ? written.join(", ") : "(none)"}`,
    verify
      ? `Last verify: ${/OVERALL:\s*PASS/i.test(verify.content ?? "") ? "PASS" : "FAIL or partial"}`
      : "Last verify: (none)",
  );

  if (locked) {
    lines.push(
      `Paths: use project-relative paths under ${locked}/ (e.g. src/index.css — not bare src/ at workspace root).`,
    );
  }

  if (!isAwarenessComplete(threadId)) {
    lines.push("Awareness: incomplete — honor turn-start EXISTS/MISSING brief or call inspect_codebase.");
  }

  if (known.length) {
    lines.push(`Known paths this turn: ${known.slice(-6).join(", ")}`);
  }

  lines.push(`Agent loop step: ${step + 1}`);

  const brief = lines.join("\n");
  const prev = lastBriefByThread.get(threadId);
  if (prev === brief) return null;
  lastBriefByThread.set(threadId, brief);
  return brief;
}

export function clearAgentStepContextBrief(threadId) {
  lastBriefByThread.delete(threadId);
}
