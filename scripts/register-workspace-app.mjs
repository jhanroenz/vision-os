/**
 * One-shot: register an existing workspace web project as a VisionOS user app.
 * Usage: node scripts/register-workspace-app.mjs [slug] [sourcePath]
 */
import { loadVisionEnv } from "../src/lib/server/dotenvLoad.js";

loadVisionEnv();

const slug = process.argv[2] ?? "tic-tac-toe";
const sourcePath = process.argv[3] ?? ".";

const { initDatabase } = await import("../src/lib/server/db.js");
const { importWorkspaceAsUserApp } = await import("../src/lib/server/userApps/import.js");

await initDatabase();

const result = await importWorkspaceAsUserApp({
  id: slug,
  name: slug === "tic-tac-toe" ? "Tic Tac Toe" : slug,
  sourcePath,
  icon: "⭕",
  publish: true,
});

console.log(JSON.stringify(result, null, 2));
