import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  workspaceAppDir,
  repoTemplateRoot,
  registryIdFromSlug,
} from "../userApps/paths.js";
import {
  manifestSchema,
  writeManifest,
  readManifestFromDir,
} from "../userApps/manifest.js";
import {
  listUserApps,
  setAppData,
  createAppJob,
} from "../userApps/repository.js";
import { publishUserApp } from "../userApps/publish.js";
import { registerUserApp } from "../userApps/register.js";
import { scanAppSlug } from "../userApps/scanner.js";
import { parseScheduleToNextRun } from "../userApps/jobRunner.js";
import { importWorkspaceAsUserApp } from "../userApps/import.js";

function fallbackNameFromSlug(slug) {
  return String(slug ?? "my-app")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else await fs.copyFile(from, to);
  }
}

export const createUserAppTool = tool(
  async ({ id, name, type, icon, permissions }) => {
    const slug = String(id).trim();
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return "Invalid id — use lowercase slug [a-z0-9-]+";
    }
    const appDir = workspaceAppDir(slug);
    try {
      await fs.access(appDir);
      return `App folder already exists: apps/${slug}/. Use update_user_app_manifest or list_user_apps.`;
    } catch {
      // ok
    }

    const appType = type ?? "sandbox";
    await copyDir(path.join(repoTemplateRoot(), appType), appDir);

    const manifest = manifestSchema.parse({
      id: slug,
      name: name?.trim() || fallbackNameFromSlug(slug),
      icon: icon ?? "📦",
      type: appType,
      permissions: permissions ?? ["storage"],
    });
    await writeManifest(appDir, manifest);
    const app = await scanAppSlug(slug, { source: "workspace" });

    return JSON.stringify(
      {
        ok: true,
        slug,
        registryId: registryIdFromSlug(slug),
        path: `apps/${slug}/`,
        app,
      },
      null,
      2,
    );
  },
  {
    name: "create_user_app",
    description:
      "Scaffold a new user app under workspace/apps/<id>/ from sandbox, schema, or service template.",
    schema: z.object({
      id: z.string().describe("App slug [a-z0-9-]+"),
      name: z.string().optional(),
      type: z.enum(["sandbox", "schema", "service"]).optional(),
      icon: z.string().optional(),
      permissions: z.array(z.string()).optional(),
    }),
  },
);

export const updateUserAppManifestTool = tool(
  async ({ id, patch }) => {
    const slug = String(id).trim();
    const appDir = workspaceAppDir(slug);
    let manifest;
    try {
      manifest = await readManifestFromDir(appDir);
    } catch {
      return `App not found in workspace: apps/${slug}/`;
    }
    const merged = manifestSchema.parse({ ...manifest, ...patch, id: slug });
    await writeManifest(appDir, merged);
    const app = await scanAppSlug(slug, { source: "workspace" });
    return JSON.stringify({ ok: true, app }, null, 2);
  },
  {
    name: "update_user_app_manifest",
    description: "Patch visionos.app.json fields for a workspace app.",
    schema: z.object({
      id: z.string(),
      patch: z.record(z.unknown()).describe("Manifest fields to merge"),
    }),
  },
);

export const registerUserAppTool = tool(
  async ({ id, sourcePath }) => {
    const slug = String(id).trim();
    try {
      const result = await registerUserApp(slug, { sourcePath });
      const app = result.app;
      return JSON.stringify(
        {
          ok: true,
          registered: true,
          action: result.action,
          slug,
          app,
          openFrom: "Start menu → My Apps",
          event: app
            ? { type: "user_app_published", slug, appId: app.id }
            : null,
        },
        null,
        2,
      );
    } catch (error) {
      return `Register failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "register_user_app",
    description:
      "Register a completed workspace app in VisionOS My Apps (import if needed, then publish). REQUIRED last step after building apps/<slug>/ with visionos.app.json and index.html. Do not skip.",
    schema: z.object({
      id: z.string().describe("App slug [a-z0-9-]+"),
      sourcePath: z
        .string()
        .optional()
        .describe("Only if index.html is outside apps/<id>/ (default: apps/<id>/)"),
    }),
  },
);

export const publishUserAppTool = tool(
  async ({ id }) => {
    const slug = String(id).trim();
    try {
      const app = await publishUserApp(slug);
      return JSON.stringify(
        {
          ok: true,
          published: true,
          app,
          openFrom: "Start menu → My Apps, or App Manager",
          event: { type: "user_app_published", slug, appId: app.id },
        },
        null,
        2,
      );
    } catch (error) {
      return `Publish failed: ${error.message}`;
    }
  },
  {
    name: "publish_user_app",
    description: "Validate and publish workspace app to user data dir; syncs registry.",
    schema: z.object({ id: z.string() }),
  },
);

export const listUserAppsTool = tool(
  async () => {
    const apps = listUserApps();
    return JSON.stringify({ apps }, null, 2);
  },
  {
    name: "list_user_apps",
    description: "List draft and published user apps from the registry.",
    schema: z.object({}),
  },
);

export const setAppDataTool = tool(
  async ({ appId, key, value }) => {
    const slug = String(appId).replace(/^user:/, "");
    const id = registryIdFromSlug(slug);
    const result = setAppData(id, String(key), value);
    return JSON.stringify({ ok: true, ...result }, null, 2);
  },
  {
    name: "set_app_data",
    description: "Write scoped app_data storage for a user app (schema/service apps).",
    schema: z.object({
      appId: z.string().describe("App slug or user:slug"),
      key: z.string(),
      value: z.unknown(),
    }),
  },
);

export const createAppJobTool = tool(
  async ({ appId, name, schedule, handler, payload, script }) => {
    const slug = String(appId).replace(/^user:/, "");
    const id = registryIdFromSlug(slug);
    const appDir = workspaceAppDir(slug);
    if (script && handler === "script") {
      const jobsDir = path.join(appDir, "server", "jobs");
      await fs.mkdir(jobsDir, { recursive: true });
      await fs.writeFile(path.join(jobsDir, script), payload?.scriptBody ?? "// job\n", "utf-8");
    }
    const job = createAppJob({
      appId: id,
      name: String(name),
      schedule: String(schedule ?? "interval:60000"),
      handler: String(handler ?? "agent_prompt"),
      payload: payload ?? null,
      nextRunAt: parseScheduleToNextRun(String(schedule ?? "interval:60000")),
    });
    return JSON.stringify({ ok: true, job }, null, 2);
  },
  {
    name: "create_app_job",
    description: "Add a scheduled job for a user app.",
    schema: z.object({
      appId: z.string(),
      name: z.string(),
      schedule: z.string().optional(),
      handler: z.enum(["agent_prompt", "script"]).optional(),
      payload: z.record(z.unknown()).optional(),
      script: z.string().optional().describe("Script filename for handler=script"),
    }),
  },
);

export const importUserAppTool = tool(
  async ({ id, name, sourcePath, icon, publish }) => {
    const slug = String(id).trim();
    try {
      const result = await importWorkspaceAsUserApp({
        id: slug,
        name,
        sourcePath: sourcePath ?? ".",
        icon: icon ?? "🎮",
        publish: publish !== false,
      });
      return JSON.stringify(
        {
          ok: true,
          ...result,
          openFrom: "Start menu → My Apps, or App Manager",
          event: result.published
            ? {
                type: "user_app_published",
                slug,
                appId: result.published.id,
              }
            : null,
        },
        null,
        2,
      );
    } catch (error) {
      return `Import failed: ${error.message}`;
    }
  },
  {
    name: "import_user_app",
    description:
      "Wrap an existing workspace HTML project (with index.html) into workspace/apps/<id>/, register, and publish to VisionOS.",
    schema: z.object({
      id: z.string().describe("App slug [a-z0-9-]+"),
      name: z.string().optional(),
      sourcePath: z
        .string()
        .optional()
        .describe("Workspace-relative folder with index.html (default: .)"),
      icon: z.string().optional(),
      publish: z.boolean().optional().describe("Publish after import (default true)"),
    }),
  },
);

export const USER_APP_TOOLS = [
  createUserAppTool,
  importUserAppTool,
  registerUserAppTool,
  updateUserAppManifestTool,
  publishUserAppTool,
  listUserAppsTool,
  setAppDataTool,
  createAppJobTool,
];
