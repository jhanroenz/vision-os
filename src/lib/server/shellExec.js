import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { resolveSafePath } from "./workspace.js";
import { NON_INTERACTIVE_ENV } from "./nonInteractiveScaffold.js";

const execAsync = promisify(exec);

/**
 * @param {{
 *   relCwd: string,
 *   success: boolean,
 *   exitCode: number | string,
 *   stdout?: string,
 *   stderr?: string,
 *   timedOut?: boolean,
 *   label?: string,
 * }} opts
 */
export function formatCommandResult(opts) {
  const parts = [];
  if (opts.label) parts.push(`label: ${opts.label}`);
  parts.push(`cwd: ${opts.relCwd}`);
  parts.push(
    opts.success
      ? `RESULT: SUCCESS (exit ${opts.exitCode})`
      : `RESULT: FAILED (exit ${opts.exitCode})`,
  );
  if (opts.stdout) parts.push(`stdout:\n${opts.stdout}`);
  if (opts.stderr) parts.push(`stderr:\n${opts.stderr}`);
  if (opts.timedOut) parts.push("(command timed out)");
  return parts.join("\n\n") || `cwd: ${opts.relCwd}\nRESULT: SUCCESS (exit 0)`;
}

/**
 * @param {{ command: string, cwd?: string, timeout?: number, maxTimeoutCap?: number }} opts
 */
export async function executeShellCommand({
  command,
  cwd = ".",
  timeout = 30,
  maxTimeoutCap = 120,
}) {
  const maxTimeout =
    Math.min(Math.max(timeout, 5), maxTimeoutCap) * 1000;
  const workDir = resolveSafePath(cwd);
  const relCwd =
    path.relative(resolveSafePath("."), workDir).replace(/\\/g, "/") || ".";

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout: maxTimeout,
      maxBuffer: 1024 * 1024,
      shell: "/bin/bash",
      env: {
        ...process.env,
        ...NON_INTERACTIVE_ENV,
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        LANG: "C.UTF-8",
      },
    });

    return {
      success: true,
      exitCode: 0,
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      timedOut: false,
      relCwd,
    };
  } catch (error) {
    return {
      success: false,
      exitCode: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      timedOut: Boolean(error.killed),
      relCwd,
    };
  }
}
