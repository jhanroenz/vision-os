import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { resolveSafePath } from "./workspace.js";

function plansDirAbs() {
  return path.join(config.workspaceDir, ".jarvis", "plans");
}

function planFileAbs(threadId) {
  return path.join(plansDirAbs(), `${threadId}.json`);
}

export function planFileRelative(threadId) {
  const abs = planFileAbs(threadId);
  const workspace = resolveSafePath(".");
  return path.relative(workspace, abs).replace(/\\/g, "/");
}

export async function persistExecutionPlan(threadId, plan, { mode = "planning" } = {}) {
  await fs.mkdir(plansDirAbs(), { recursive: true });

  const payload = {
    version: 1,
    threadId,
    mode,
    title: plan.title ?? "Task plan",
    updatedAt: new Date().toISOString(),
    steps: (plan.steps ?? []).map((s) => ({
      id: String(s.id),
      label: s.label,
      status: s.status ?? "pending",
      tool: s.tool ?? null,
      args: s.args ?? null,
    })),
  };

  const filePath = planFileAbs(threadId);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  return planFileRelative(threadId);
}

export async function loadExecutionPlan(threadId) {
  try {
    const raw = await fs.readFile(planFileAbs(threadId), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function deleteExecutionPlan(threadId) {
  try {
    await fs.unlink(planFileAbs(threadId));
    return true;
  } catch {
    return false;
  }
}

export async function setExecutionPlanMode(threadId, mode) {
  const existing = await loadExecutionPlan(threadId);
  if (!existing) return null;
  existing.mode = mode;
  existing.updatedAt = new Date().toISOString();
  await fs.writeFile(planFileAbs(threadId), `${JSON.stringify(existing, null, 2)}\n`, "utf-8");
  return existing;
}

export function planFileBlock(threadId, relPath) {
  if (!relPath) return "";
  return (
    `Execution plan file: ${relPath}\n` +
    "Follow this plan step-by-step during execute phase. Update via update_task_plan; file syncs automatically."
  );
}
