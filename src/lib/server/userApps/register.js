import fs from "node:fs/promises";
import path from "node:path";
import { workspaceAppDir, MANIFEST_FILENAME } from "./paths.js";
import { importWorkspaceAsUserApp } from "./import.js";
import { publishUserApp } from "./publish.js";
import { getUserAppBySlug } from "./repository.js";
import { resolveSafePath } from "../workspace.js";

async function indexHtmlExists(relativePath) {
  try {
    const full = resolveSafePath(relativePath);
    const stat = await fs.stat(path.join(full, "index.html"));
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function packageReadyInApps(slug) {
  try {
    await fs.access(path.join(workspaceAppDir(slug), MANIFEST_FILENAME));
    await fs.access(path.join(workspaceAppDir(slug), "index.html"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Register a workspace app package in VisionOS (import if needed, then publish).
 * @param {string} slug
 * @param {{ sourcePath?: string }} [opts]
 */
export async function registerUserApp(slug, { sourcePath } = {}) {
  const id = String(slug ?? "").trim();
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error("Invalid id — use lowercase slug [a-z0-9-]+");
  }

  if (await packageReadyInApps(id)) {
    const existing = getUserAppBySlug(id);
    if (existing?.status === "published") {
      return { ok: true, action: "already_published", slug: id, app: existing };
    }
    const app = await publishUserApp(id);
    return { ok: true, action: "published", slug: id, app };
  }

  const candidates = [];
  if (sourcePath) candidates.push(sourcePath);
  if (!candidates.includes(`apps/${id}`)) candidates.push(`apps/${id}`);
  if (!candidates.includes(".")) candidates.push(".");

  for (const rel of candidates) {
    if (!(await indexHtmlExists(rel))) continue;
    const result = await importWorkspaceAsUserApp({
      id,
      sourcePath: rel,
      publish: true,
    });
    const app = result.published ?? result.draft;
    return { ok: true, action: "imported", slug: id, app, ...result };
  }

  throw new Error(
    `Cannot register apps/${id}/ — add visionos.app.json and index.html under workspace/apps/${id}/ first`,
  );
}

/** Detect slug from a VisionOS publish API curl in shell output. */
export function parsePublishSlugFromShellCommand(command) {
  const cmd = String(command ?? "");
  const match = cmd.match(/\/api\/user-apps\/([a-z0-9-]+)\/publish/i);
  return match?.[1] ?? null;
}

export function wasAppRegisteredInToolEvents(toolEvents = []) {
  for (const event of toolEvents) {
    const name = String(event?.name ?? "").toLowerCase();
    if (name === "register_user_app" || name === "publish_user_app" || name === "import_user_app") {
      if (event.type === "tool_call" || event.type === "tool_result") return true;
    }
    if (event.type === "tool_call" && (name === "run_bash" || name === "shell")) {
      const cmd = event.args?.command ?? event.args?.cmd ?? "";
      if (parsePublishSlugFromShellCommand(cmd)) return true;
    }
  }
  return false;
}

export function detectAppSourceFromToolEvents(toolEvents = []) {
  let sourcePath = null;
  let existingSlug = null;

  for (const event of toolEvents) {
    const args = event?.args ?? {};
    const candidates = [args.path, args.file_path, args.target_file, args.filePath].filter(
      Boolean,
    );

    for (const raw of candidates) {
      const normalized = String(raw).replace(/\\/g, "/").replace(/^\.\//, "");

      const pkgMatch = normalized.match(/(?:^|\/)apps\/([a-z0-9-]+)\//);
      if (pkgMatch) existingSlug = pkgMatch[1];

      if (/index\.html$/i.test(normalized)) {
        const dir = path.posix.dirname(normalized);
        sourcePath = dir === "." || dir === "" ? "." : dir;
      }

      if (normalized.includes(`apps/`) && normalized.endsWith(MANIFEST_FILENAME)) {
        const manifestMatch = normalized.match(/apps\/([a-z0-9-]+)\//);
        if (manifestMatch) existingSlug = manifestMatch[1];
      }
    }
  }

  return { sourcePath, existingSlug };
}
