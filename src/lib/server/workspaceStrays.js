import fs from "node:fs/promises";
import path from "node:path";
import { fileExists } from "./codebase/context.js";
import { resolveSafePath } from "./workspace.js";

const STRAY_DIR_NAMES = new Set([
  "src",
  "components",
  "public",
  "app",
  "lib",
  "assets",
  "styles",
  "dist",
]);

/**
 * Paths at workspace root that belong inside activeProject but were created outside it.
 * @returns {Promise<Array<{ path: string, reason: string }>>}
 */
export async function findWorkspaceStrays(activeProject) {
  if (!activeProject || activeProject === ".") return [];

  const project = String(activeProject).replace(/\\/g, "/").replace(/\/+$/, "");
  const workspaceRoot = resolveSafePath(".");
  const strays = [];

  let entries;
  try {
    entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const ent of entries) {
    const name = ent.name;
    if (name.startsWith(".") || name === project || project.startsWith(`${name}/`)) {
      continue;
    }

    if (ent.isDirectory() && STRAY_DIR_NAMES.has(name)) {
      const atRoot = await fileExists(path.join(workspaceRoot, name));
      const inProject = await fileExists(resolveSafePath(`${project}/${name}`));
      if (atRoot && (inProject || project)) {
        strays.push({
          path: name,
          reason:
            inProject
              ? `Duplicate "${name}/" at workspace root — project "${project}" already has ${project}/${name}/`
              : `Orphan "${name}/" at workspace root — should be under "${project}/" or removed`,
        });
      }
    }

    if (ent.isFile() && name === "package.json") {
      const inProject = await fileExists(resolveSafePath(`${project}/package.json`));
      if (inProject) {
        strays.push({
          path: name,
          reason: `Stray package.json at workspace root while project is "${project}"`,
        });
      }
    }
  }

  return strays;
}

export function formatStrayReport(strays, activeProject) {
  if (!strays.length) return "";
  const lines = [
    "WORKSPACE STRAY PATHS (must remove before handoff):",
    `Active project: ${activeProject}`,
  ];
  for (const s of strays) {
    lines.push(`  - ${s.path}: ${s.reason}`);
  }
  lines.push(
    "Fix: call cleanup_stray_paths with these paths, or run_bash `rm -rf <path>` from workspace root, then verify_project again.",
  );
  return lines.join("\n");
}

export async function removeWorkspaceStrays(activeProject, paths) {
  const allowed = await findWorkspaceStrays(activeProject);
  const allowedSet = new Set(allowed.map((s) => s.path));
  const removed = [];
  const skipped = [];

  for (const raw of paths ?? []) {
    const p = String(raw).replace(/\\/g, "/").replace(/\/+$/, "").split("/")[0];
    if (!allowedSet.has(p)) {
      skipped.push(`${p} (not a detected stray)`);
      continue;
    }
    const full = resolveSafePath(p);
    await fs.rm(full, { recursive: true, force: true });
    removed.push(p);
  }

  return { removed, skipped, remaining: await findWorkspaceStrays(activeProject) };
}
