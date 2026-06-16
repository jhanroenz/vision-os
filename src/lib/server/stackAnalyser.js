import path from "node:path";
import { analyser, FSProvider, flatten, tech } from "@specfy/stack-analyser";
import "@specfy/stack-analyser/dist/autoload.js";
import { resolveSafePath } from "./workspace.js";

/** Tech categories worth surfacing to the agent (skip SaaS noise). */
const SUMMARY_TECH_TYPES = new Set([
  "language",
  "framework",
  "ui_framework",
  "builder",
  "package_manager",
  "runtime",
  "test",
  "orm",
  "db",
  "ssg",
  "linter",
  "ci",
]);

const MAX_TECHS_PER_GROUP = 6;
const MAX_COMPONENTS = 8;

function normalizeRelPath(p) {
  return String(p ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

function techLabel(key) {
  return tech.indexed[key]?.name ?? key;
}

function techType(key) {
  return tech.indexed[key]?.type ?? "tool";
}

function collectTechKeys(node, bucket = new Map()) {
  for (const key of node.techs ?? []) {
    const type = techType(key);
    if (!SUMMARY_TECH_TYPES.has(type)) continue;
    const label = techLabel(key);
    if (!bucket.has(type)) bucket.set(type, new Set());
    bucket.get(type).add(label);
  }
  for (const child of node.childs ?? []) {
    collectTechKeys(child, bucket);
  }
  return bucket;
}

function formatTechGroups(bucket) {
  const order = [
    "language",
    "framework",
    "ui_framework",
    "builder",
    "package_manager",
    "runtime",
    "test",
    "orm",
    "db",
    "ssg",
    "linter",
    "ci",
  ];
  const lines = [];
  for (const type of order) {
    const labels = [...(bucket.get(type) ?? [])].slice(0, MAX_TECHS_PER_GROUP);
    if (!labels.length) continue;
    const title = type.replace(/_/g, " ");
    lines.push(`${title}: ${labels.join(", ")}`);
  }
  return lines;
}

function summarizeComponents(root) {
  const components = [];
  for (const child of root.childs ?? []) {
    const techs = [...(child.techs ?? [])]
      .filter((k) => SUMMARY_TECH_TYPES.has(techType(k)))
      .map(techLabel);
    const unique = [...new Set(techs)].slice(0, MAX_TECHS_PER_GROUP);
    if (!unique.length && !child.name) continue;
    components.push({
      name: child.name || path.basename(String(child.path ?? "")),
      path: normalizeRelPath(child.path),
      techs: unique,
    });
  }
  return components.slice(0, MAX_COMPONENTS);
}

function primaryStackLine(bucket) {
  const frameworks = [...(bucket.get("framework") ?? []), ...(bucket.get("ui_framework") ?? [])];
  const languages = [...(bucket.get("language") ?? [])];
  const builders = [...(bucket.get("builder") ?? [])];
  const parts = [];
  if (frameworks.length) parts.push(frameworks.slice(0, 3).join(" + "));
  else if (builders.length) parts.push(builders.slice(0, 2).join(" + "));
  if (languages.length) parts.push(languages.slice(0, 2).join("/"));
  return parts.join(" · ") || "unknown";
}

async function runStackAnalyser(absPath) {
  const result = await analyser({
    provider: new FSProvider({ path: absPath }),
  });
  const flat = flatten(result, true);
  const bucket = collectTechKeys(flat);
  const components = summarizeComponents(flat);
  const monorepo = (flat.childs?.length ?? 0) > 1;

  return { flat, bucket, components, monorepo };
}

/**
 * Run stack-analyser and return a compact summary for agent prompts.
 * @param {string} startRelative workspace-relative path
 */
export async function analyseProjectStack(startRelative = ".") {
  const rel = normalizeRelPath(startRelative) || ".";
  const abs = resolveSafePath(rel);
  const { bucket, components, monorepo } = await runStackAnalyser(abs);

  return {
    path: rel,
    primary: primaryStackLine(bucket),
    techGroups: formatTechGroups(bucket),
    monorepo,
    components,
  };
}

/** Test helper — scan an absolute path on disk. */
export async function analyseProjectStackAbs(absPath, relLabel = ".") {
  const { bucket, components, monorepo } = await runStackAnalyser(absPath);
  return {
    path: relLabel,
    primary: primaryStackLine(bucket),
    techGroups: formatTechGroups(bucket),
    monorepo,
    components,
  };
}

export function formatStackSummaryBrief(summary) {
  if (!summary) return "";
  const lines = [
    `[Project stack — ${summary.path}]`,
    `Primary: ${summary.primary}`,
  ];
  if (summary.monorepo && summary.components.length) {
    lines.push("Monorepo components:");
    for (const c of summary.components) {
      const techPart = c.techs.length ? ` — ${c.techs.join(", ")}` : "";
      lines.push(`  • ${c.name || c.path}${techPart}`);
    }
  }
  if (summary.techGroups.length) {
    lines.push(...summary.techGroups);
  }
  lines.push(
    "Use this stack when choosing init commands, entry files, and verify steps — do not assume other frameworks.",
  );
  return lines.join("\n");
}
