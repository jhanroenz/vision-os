import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

test("manifest schema validates sandbox app", async () => {
  const { manifestSchema } = await import("../src/lib/server/userApps/manifest.js");
  const manifest = manifestSchema.parse({
    id: "demo-app",
    name: "Demo",
    type: "sandbox",
    permissions: ["storage"],
  });
  assert.equal(manifest.id, "demo-app");
});

test("parseSchedule interval", async () => {
  const { parseScheduleToNextRun } = await import("../src/lib/server/userApps/jobRunner.js");
  const next = parseScheduleToNextRun("interval:60000", 1000);
  assert.equal(next, 61000);
});

test("serve path blocks traversal", async () => {
  const { resolveSafeAppPath } = await import("../src/lib/server/userApps/serve.js");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vos-app-"));
  await fs.writeFile(path.join(tmp, "index.html"), "<html></html>", "utf-8");
  try {
    await resolveSafeAppPath(tmp, "../../etc/passwd");
    assert.fail("should have thrown");
  } catch (error) {
    assert.match(String(error.message), /traversal|outside|denied/i);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("detectAppSourceFromToolEvents", async () => {
  const { detectAppSourceFromToolEvents } = await import(
    "../src/lib/server/userApps/register.js"
  );
  const detected = detectAppSourceFromToolEvents([
    { type: "tool_call", name: "write_file", args: { path: "index.html" } },
  ]);
  assert.equal(detected.sourcePath, ".");
});

test("shouldUseCursorAppBuilder with composer mode", async () => {
  const { shouldUseCursorAppBuilder } = await import(
    "../src/lib/server/userApps/cursorAppBuilder.js"
  );
  assert.equal(shouldUseCursorAppBuilder("hello", "chat", false), false);
  assert.equal(shouldUseCursorAppBuilder("build a game", "chat", false), true);
  assert.equal(shouldUseCursorAppBuilder("build a game", "appBuilder", false), true);
});

test("registry id slug helpers", async () => {
  const { registryIdFromSlug, slugFromRegistryId, normalizeAppSlug } = await import(
    "../src/lib/server/userApps/paths.js"
  );
  assert.equal(registryIdFromSlug("demo"), "user:demo");
  assert.equal(slugFromRegistryId("user:demo"), "demo");
  assert.equal(normalizeAppSlug("user:demo"), "demo");
});
