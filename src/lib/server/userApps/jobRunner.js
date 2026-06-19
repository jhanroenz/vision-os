import { spawn } from "node:child_process";
import path from "node:path";
import { publishedAppDir } from "./paths.js";
import {
  getUserAppById,
  listDueJobs,
  updateAppJob,
} from "./repository.js";

const INTERVAL_RE = /^interval:(\d+)$/i;
const DAILY_RE = /^daily:(\d{1,2}):(\d{2})$/i;

let timer = null;
let running = false;

export function parseScheduleToNextRun(schedule, from = Date.now()) {
  const raw = String(schedule ?? "").trim();
  const intervalMatch = raw.match(INTERVAL_RE);
  if (intervalMatch) {
    return from + Number(intervalMatch[1]);
  }
  const dailyMatch = raw.match(DAILY_RE);
  if (dailyMatch) {
    const hour = Number(dailyMatch[1]);
    const minute = Number(dailyMatch[2]);
    const next = new Date(from);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= from) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  return from + 60_000;
}

async function runAgentPromptJob(job, app) {
  const prompt =
    job.payload?.prompt ??
    job.payload?.message ??
    `Run scheduled job "${job.name}" for app ${app.name}.`;
  const { runHeadlessAgentPrompt } = await import("./headlessAgent.js");
  await runHeadlessAgentPrompt({
    appId: app.id,
    appName: app.name,
    prompt: String(prompt),
  });
}

async function runScriptJob(job, slug) {
  const scriptFile = job.payload?.script ?? `${job.name}.mjs`;
  const appDir = publishedAppDir(slug);
  const scriptPath = path.join(appDir, "server", "jobs", scriptFile);
  const timeoutMs = Number(job.payload?.timeoutMs ?? 60_000);

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: appDir,
      env: { ...process.env, VISIONOS_APP_ID: job.appId },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timerId = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Job script timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timerId);
      if (code === 0) resolve(undefined);
      else reject(new Error(stderr.trim() || `Script exited with code ${code}`));
    });
  });
}

async function executeJob(job) {
  const app = getUserAppById(job.appId);
  if (!app) throw new Error(`App not found for job ${job.id}`);
  const slug = app.slug;

  if (job.handler === "agent_prompt") {
    await runAgentPromptJob(job, app);
  } else if (job.handler === "script") {
    await runScriptJob(job, slug);
  } else {
    throw new Error(`Unknown job handler: ${job.handler}`);
  }
}

export async function runDueJobs(now = Date.now()) {
  if (running) return { skipped: true };
  running = true;
  const results = [];
  try {
    const due = listDueJobs(now);
    for (const job of due) {
      try {
        await executeJob(job);
        updateAppJob(job.appId, job.id, {
          lastRunAt: now,
          nextRunAt: parseScheduleToNextRun(job.schedule, now),
          lastError: null,
        });
        results.push({ id: job.id, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateAppJob(job.appId, job.id, {
          lastRunAt: now,
          nextRunAt: parseScheduleToNextRun(job.schedule, now),
          lastError: message,
        });
        results.push({ id: job.id, ok: false, error: message });
        console.error(`[userApps] Job ${job.id} failed:`, message);
      }
    }
  } finally {
    running = false;
  }
  return { results };
}

export function startJobRunner({ intervalMs = 60_000 } = {}) {
  if (timer) return;
  void runDueJobs();
  timer = setInterval(() => {
    void runDueJobs();
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopJobRunner() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
