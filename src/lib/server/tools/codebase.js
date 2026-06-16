import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { normalizeUpdateTaskPlanArgs } from "../taskPlanNormalize.js";
import { bashTool } from "./bashTool.js";
import {
  describeCodebase,
  copyTemplateFiles,
  getTemplatesDir,
} from "../codebase/context.js";
import {
  analyseProjectStack,
  formatStackSummaryBrief,
} from "../stackAnalyser.js";
import {
  getThreadCwd,
  lockProjectRoot,
  syncActiveProjectRoot,
} from "../workspace.js";

const manifestPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
  "manifest.json",
);

async function loadManifest() {
  const raw = await fs.readFile(manifestPath, "utf-8");
  return JSON.parse(raw);
}

export function createCodebaseTools(ctx = {}) {
  const threadId = ctx.threadId ?? "default";
  const onPlanEvent = ctx.onPlanEvent ?? (() => {});

  const detectStackTool = tool(
    async ({ path: startPath }) => {
      const searchFrom = startPath ?? getThreadCwd(threadId);
      try {
        const summary = await analyseProjectStack(searchFrom);
        return formatStackSummaryBrief(summary);
      } catch (error) {
        return `Stack detection failed: ${error?.message ?? error}`;
      }
    },
    {
      name: "detect_stack",
      description:
        "Detect the project's tech stack (languages, frameworks, build tools, monorepo layout) from manifests and config files. " +
        "Call after inspect_codebase when you need framework-level certainty (SvelteKit vs Vite+Svelte, Next.js, PHP/Laravel, hybrid monorepos).",
      schema: z.object({
        path: z
          .string()
          .optional()
          .describe("Project folder relative to workspace (default: agent cwd)"),
      }),
    },
  );

  const inspectCodebaseTool = tool(
    async ({ path: startPath }) => {
      const searchFrom = startPath ?? getThreadCwd(threadId);
      const info = await describeCodebase(searchFrom);

      if (info.projectRoot) {
        await lockProjectRoot(threadId, info.projectRoot, { source: "inspect" });
      }

      if (!info.projectRoot) {
        return info.message;
      }

      const header = info.scaffold
        ? [
            info.message,
            `Type: ${info.projectType} (scaffolding)`,
            info.stackHints?.length
              ? `Stack hints: ${info.stackHints.join(", ")}`
              : "",
          ]
        : [
            info.message,
            `Type: ${info.projectType}`,
            info.name ? `Name: ${info.name}` : "",
            `Scripts: ${Object.keys(info.scripts ?? {}).join(", ") || "(none)"}`,
            info.entryHints?.length
              ? `Entry hints: ${info.entryHints.join(", ")}`
              : "",
          ];

      return [
        ...header,
        "",
        "Files:",
        info.files || "(empty)",
      ]
        .filter(Boolean)
        .join("\n");
    },
    {
      name: "inspect_codebase",
      description:
        "Detect project root (package.json, Cargo.toml, etc.) from a path, list structure, and set active project context. " +
        "Works on scaffold folders too (empty dirs without package.json yet). " +
        "Call BEFORE editing files in a codebase.",
      schema: z.object({
        path: z
          .string()
          .optional()
          .describe("Relative path to start search from (default: agent cwd)"),
      }),
    },
  );

  const applyTemplateTool = tool(
    async ({ template, projectDir }) => {
      const manifest = await loadManifest();
      const entry = manifest[template];
      if (!entry) {
        return `Unknown template "${template}". Available: ${Object.keys(manifest).join(", ")}`;
      }

      const target = projectDir ?? getThreadCwd(threadId);
      await copyTemplateFiles(template, target, entry.files);
      await lockProjectRoot(threadId, target, { source: "inspect" });
      await syncActiveProjectRoot(threadId, target);

      const outputs = [`Applied template "${template}" to ${target}`];
      for (const [dest] of Object.entries(entry.files)) {
        outputs.push(`  - ${target}/${dest}`);
      }

      if (entry.post?.length) {
        for (const cmd of entry.post) {
          const result = await bashTool.invoke({ command: cmd, cwd: target, timeout: 180 });
          outputs.push(`$ ${cmd}\n${result.slice(0, 500)}`);
        }
      }

      return outputs.join("\n");
    },
    {
      name: "apply_template",
      description:
        "Copy bundled code templates into a project directory. Use after scaffolding or when user wants boilerplate UI.",
      schema: z.object({
        template: z.string().describe("Template id from manifest (see inspect_codebase or manifest for ids)"),
        projectDir: z
          .string()
          .optional()
          .describe("Project directory relative to workspace (default: agent cwd)"),
      }),
    },
  );

  const planStepSchema = z.object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    label: z.string(),
    status: z
      .enum(["pending", "in_progress", "done", "skipped"])
      .optional(),
  });

  const updateTaskPlanTool = tool(
    async ({ title, steps }) => {
      const { applyPlanFromTool } = await import("../taskPlan.js");
      const plan = await applyPlanFromTool(threadId, { title, steps });
      onPlanEvent({
        type: "plan",
        action: plan.created ? "create" : "update",
        plan,
      });
      const done = plan.steps.filter((s) => s.status === "done").length;
      const current = plan.steps.find((s) => s.status === "in_progress");
      return (
        `Task plan ${plan.created ? "created" : "updated"} (${plan.steps.length} steps). ` +
        `Plan file: ${plan.planFile}\n` +
        `Progress: ${done}/${plan.steps.length} done.` +
        (current
          ? `\nNow working on step ${current.id}: ${current.label}`
          : "") +
        "\nWork through steps in order. Use mark_plan_step to update status after each step."
      );
    },
    {
      name: "update_task_plan",
      description:
        "Create or update a numbered TODO checklist before multi-step coding work (GitHub Copilot style). " +
        "Steps must implement the injected acceptance criteria; omit work already satisfied (EXISTS/SKIP). " +
        "Each step: { id, label, status? } where status is pending|in_progress|done|skipped. " +
        "First step is auto-set to in_progress. Include a final verify step.",
      schema: z.preprocess(
        (raw) => normalizeUpdateTaskPlanArgs(raw) ?? raw,
        z.object({
          title: z.string().optional().describe("Short plan title"),
          steps: z
            .array(planStepSchema)
            .min(2)
            .describe("Numbered TODO steps — one logical action per step"),
        }),
      ),
    },
  );

  const markPlanStepTool = tool(
    async ({ step_id, status }) => {
      const { markPlanStep, planProgressSummary, getCurrentPlanStep } =
        await import("../taskPlan.js");
      const plan = await markPlanStep(threadId, step_id, status);
      if (!plan) {
        return "No active task plan — call update_task_plan first.";
      }
      onPlanEvent({ type: "plan", action: "update", plan });
      const current = getCurrentPlanStep(threadId);
      return (
        `Step ${step_id} → ${status}. Progress: ${planProgressSummary(threadId)}.` +
        (current
          ? ` Next: step ${current.id} — ${current.label}`
          : " All steps complete.")
      );
    },
    {
      name: "mark_plan_step",
      description:
        "Mark a single TODO step status. Exact args: step_id + status (done|skipped|in_progress|pending). " +
        "Plan auto-advances on successful write_file — call only to skip or after write_file SKIP (already exists). " +
        "Do not repeat without a new tool result between attempts.",
      schema: z.object({
        step_id: z.string().describe("Step id from the task plan"),
        status: z
          .enum(["pending", "in_progress", "done", "skipped"])
          .describe("New status for this step"),
      }),
    },
  );

  return [
    inspectCodebaseTool,
    detectStackTool,
    applyTemplateTool,
    updateTaskPlanTool,
    markPlanStepTool,
  ];
}

export { loadManifest, getTemplatesDir };
