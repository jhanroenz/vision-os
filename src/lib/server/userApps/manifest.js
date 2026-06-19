import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { MANIFEST_FILENAME } from "./paths.js";

export const APP_TYPES = ["sandbox", "schema", "service"];

export const PERMISSION_TOKENS = [
  "storage",
  "files:read",
  "agent:prompt",
  "jobs",
  "network",
];

export const manifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "id must be lowercase slug [a-z0-9-]+"),
  name: z.string().min(1),
  icon: z.string().default("📦"),
  type: z.enum(["sandbox", "schema", "service"]),
  entry: z.string().default("index.html"),
  schema: z.string().optional(),
  defaultWidth: z.number().int().positive().optional(),
  defaultHeight: z.number().int().positive().optional(),
  launcher: z.boolean().default(true),
  permissions: z
    .array(z.enum(PERMISSION_TOKENS))
    .default(["storage"]),
});

/** @typedef {z.infer<typeof manifestSchema>} AppManifest */

export function parseManifestJson(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  return manifestSchema.parse(data);
}

export async function readManifestFromDir(appDir) {
  const raw = await fs.readFile(path.join(appDir, MANIFEST_FILENAME), "utf-8");
  return parseManifestJson(raw);
}

export async function writeManifest(appDir, manifest) {
  const parsed = manifestSchema.parse(manifest);
  await fs.mkdir(appDir, { recursive: true });
  await fs.writeFile(
    path.join(appDir, MANIFEST_FILENAME),
    `${JSON.stringify(parsed, null, 2)}\n`,
    "utf-8",
  );
  return parsed;
}

export async function validateManifestForPublish(manifest, appDir) {
  const errors = [];
  if (manifest.type === "sandbox") {
    const entry = manifest.entry ?? "index.html";
    try {
      const stat = await fs.stat(path.join(appDir, entry));
      if (!stat.isFile()) errors.push(`entry path is not a file: ${entry}`);
    } catch {
      errors.push(`Missing entry file: ${entry}`);
    }
  }
  if (manifest.type === "schema") {
    const schemaPath = manifest.schema ?? "schema.json";
    try {
      const stat = await fs.stat(path.join(appDir, schemaPath));
      if (!stat.isFile()) errors.push(`schema path is not a file: ${schemaPath}`);
    } catch {
      errors.push(`Missing schema file: ${schemaPath}`);
    }
  }
  return errors;
}

export function manifestToRegistryFields(manifest) {
  return {
    slug: manifest.id,
    name: manifest.name,
    icon: manifest.icon ?? "📦",
    type: manifest.type,
    manifestJson: JSON.stringify(manifest),
    defaultWidth: manifest.defaultWidth ?? null,
    defaultHeight: manifest.defaultHeight ?? null,
    launcher: manifest.launcher !== false ? 1 : 0,
  };
}
