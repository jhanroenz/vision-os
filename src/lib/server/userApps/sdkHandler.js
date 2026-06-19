import {
  deleteAppData,
  getAppData,
  setAppData,
  listAppDataKeys,
  createAppJob,
  listAppJobs,
  getUserAppBySlug,
} from "./repository.js";
import { assertPermission } from "./permissions.js";
import { registryIdFromSlug } from "./paths.js";
import { parseScheduleToNextRun } from "./jobRunner.js";
import { runDueJobs } from "./jobRunner.js";

export async function handleSdkRpc(slug, manifest, method, args = {}) {
  const appId = registryIdFromSlug(slug);

  if (method === "storage.get") {
    assertPermission(manifest, "storage");
    const key = String(args.key ?? "");
    if (!key) throw new Error("storage.get requires key");
    const row = getAppData(appId, key);
    return row?.value ?? null;
  }

  if (method === "storage.set") {
    assertPermission(manifest, "storage");
    const key = String(args.key ?? "");
    if (!key) throw new Error("storage.set requires key");
    setAppData(appId, key, args.value);
    return { ok: true };
  }

  if (method === "storage.delete") {
    assertPermission(manifest, "storage");
    const key = String(args.key ?? "");
    deleteAppData(appId, key);
    return { ok: true };
  }

  if (method === "storage.list") {
    assertPermission(manifest, "storage");
    return listAppDataKeys(appId);
  }

  if (method === "agent.prompt") {
    assertPermission(manifest, "agent:prompt");
    const message = String(args.message ?? "").trim();
    if (!message) throw new Error("agent.prompt requires message");
    const { runHeadlessAgentPrompt } = await import("./headlessAgent.js");
    const app = getUserAppBySlug(slug);
    return runHeadlessAgentPrompt({
      appId,
      appName: app?.name ?? slug,
      prompt: message,
    });
  }

  if (method === "os.openApp") {
    const targetId = String(args.appId ?? "");
    if (!targetId) throw new Error("os.openApp requires appId");
    return { ok: true, appId: targetId, props: args.props ?? {} };
  }

  if (method === "os.notify") {
    return {
      ok: true,
      title: String(args.title ?? "Notification"),
      body: String(args.body ?? ""),
    };
  }

  if (method === "jobs.create") {
    assertPermission(manifest, "jobs");
    const job = createAppJob({
      appId,
      name: String(args.name ?? "job"),
      schedule: String(args.schedule ?? "interval:60000"),
      handler: String(args.handler ?? "agent_prompt"),
      payload: args.payload ?? null,
      nextRunAt: parseScheduleToNextRun(String(args.schedule ?? "interval:60000")),
    });
    return job;
  }

  if (method === "jobs.list") {
    assertPermission(manifest, "jobs");
    return listAppJobs(appId);
  }

  if (method === "jobs.run") {
    assertPermission(manifest, "jobs");
    const jobId = String(args.jobId ?? "");
    const jobs = listAppJobs(appId);
    const job = jobs.find((j) => j.id === jobId);
    if (!job) throw new Error("Job not found");
    await runDueJobs(Date.now());
    return { ok: true, jobId };
  }

  throw new Error(`Unknown SDK method: ${method}`);
}
