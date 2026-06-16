import { exec } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { resolveSafePath } from "../workspace.js";
import { buildVerificationCommands } from "../verification.js";
import { extractVerificationErrors } from "../verificationDiagnostics.js";
import {
  resolveVerifyProjectRoot,
  buildMissingMarkerMessage,
} from "../codeCheck/resolveVerifyRoot.js";
import {
  findWorkspaceStrays,
  formatStrayReport,
} from "../workspaceStrays.js";

const execAsync = promisify(exec);

async function runCheck({ command, cwd, timeout = 120 }) {
  const workDir = resolveSafePath(cwd);
  const started = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout: timeout * 1000,
      maxBuffer: 1024 * 1024,
      shell: "/bin/bash",
      env: {
        ...process.env,
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        LANG: "C.UTF-8",
        CI: "true",
      },
    });

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    return {
      name: command,
      passed: true,
      exitCode: 0,
      elapsed,
      output: output.slice(0, 3000),
    };
  } catch (error) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const output = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
    return {
      name: command,
      passed: false,
      exitCode: error.code ?? 1,
      elapsed,
      output: output.slice(0, 3000),
      timedOut: Boolean(error.killed),
    };
  }
}

export const verifyProjectTool = tool(
  async ({ path: startPath = ".", checks = "all" }, { configurable } = {}) => {
    const threadId = configurable?.threadId ?? null;
    const agentPath = String(startPath ?? ".").replace(/\\/g, "/") || ".";

    const detected = await resolveVerifyProjectRoot(agentPath, threadId);

    if (!detected.projectRoot) {
      const absPath = resolveSafePath(detected.resolvedFrom ?? agentPath);
      let dirExists = false;
      try {
        const stat = await fs.stat(absPath);
        dirExists = stat.isDirectory();
      } catch {
        dirExists = false;
      }

      if (!dirExists) {
        return (
          "OVERALL: FAIL\n" +
          `Directory "${detected.resolvedFrom ?? agentPath}" does not exist.\n` +
          buildMissingMarkerMessage(detected.resolvedFrom ?? agentPath, threadId)
            .split("\n")
            .slice(1)
            .join("\n")
        );
      }

      return buildMissingMarkerMessage(detected.resolvedFrom ?? agentPath, threadId);
    }

    const { projectRoot, projectType } = detected;

    if (projectType === "bare") {
      const { verifyBareProject } = await import("../codeCheck/bareProject.js");
      const bareResult = await verifyBareProject(projectRoot, { threadId });
      if (!bareResult) {
        return buildMissingMarkerMessage(detected.resolvedFrom ?? agentPath, threadId);
      }

      const header = [];
      if (detected.inferred && agentPath === ".") {
        header.push(
          `Path inferred from turn context — pass explicitly next time: {"path":"${projectRoot}"}`,
        );
      }
      if (detected.stack) {
        header.push(`Stack: ${detected.stack}`);
      }

      return [...header, bareResult.output].filter(Boolean).join("\n");
    }

    let actionSummary = null;
    if (threadId) {
      try {
        const { formatActionSummary } = await import("../actionTracker.js");
        actionSummary = formatActionSummary(threadId);
      } catch {
        // action tracker not available
      }
    }

    const commands = await buildVerificationCommands(projectRoot, projectType, {
      checks,
    });

    const lines = [`Project: ${projectRoot} (${projectType})`];

    if (detected.inferred && agentPath === ".") {
      lines.push(
        `Path inferred from turn context (you passed ".") — pass explicitly next time: {"path":"${projectRoot}"}`,
      );
    } else if (detected.resolvedFrom && detected.resolvedFrom !== projectRoot) {
      lines.push(`Resolved from: ${detected.resolvedFrom}`);
    }

    if (actionSummary) {
      lines.push("", actionSummary);
    }

    if (!commands.length) {
      lines.push(
        "",
        "No lint/test/build scripts discovered in project config.",
        "OVERALL: PASS — no failing scripts. Self-check correctness before handoff.",
      );
      return lines.join("\n");
    }

    lines.push(`Checks: ${checks}`, "", "Results:");

    let allPassed = true;

    for (const check of commands) {
      const result = await runCheck({
        command: check.command,
        cwd: projectRoot,
        timeout: check.timeout,
      });

      const status = result.passed ? "PASS" : "FAIL";
      if (!result.passed) allPassed = false;

      lines.push(
        `  [${status}] ${check.name}: ${check.command} (exit ${result.exitCode}, ${result.elapsed}s)`,
      );

      if (result.output) {
        lines.push(result.output.split("\n").map((l) => `    ${l}`).join("\n"));
      }
      if (result.timedOut) {
        lines.push("    (command timed out)");
      }
      lines.push("");
    }

    const strays = await findWorkspaceStrays(projectRoot);
    if (strays.length) {
      allPassed = false;
      lines.push(formatStrayReport(strays, projectRoot));
      lines.push("");
    }

    if (!allPassed) {
      const fullOutput = lines.join("\n");
      const { files, summary } = extractVerificationErrors(fullOutput);
      lines.push("DIAGNOSIS:");
      if (summary) lines.push(`  ${summary}`);
      if (files.length) {
        lines.push("  read_file these paths before editing:");
        for (const f of files) {
          const full = f.startsWith(projectRoot) ? f : `${projectRoot}/${f}`;
          lines.push(`    → ${full}`);
        }
      }
      lines.push(
        `  Fix the failing scripts, then call verify_project with {"path":"${projectRoot}"} again.`,
      );
    }

    lines.push(
      allPassed
        ? "OVERALL: PASS — all discovered scripts passed."
        : "OVERALL: FAIL — fix the errors above, then re-run verify_project with the same path.",
    );

    return lines.join("\n");
  },
  {
    name: "verify_project",
    description:
      "Verify a project folder. Manifest projects (package.json, Cargo.toml, …): runs discovered lint/test/build scripts. " +
      "Bare projects (HTML/JS/CSS only, no manifest): runs check_syntax on sources. " +
      "REQUIRED: pass path to the project folder — not workspace root \".\". " +
      "Example: {\"path\":\"my-site\"}. Returns OVERALL: PASS or OVERALL: FAIL.",
    schema: z.object({
      path: z
        .string()
        .describe(
          "Project folder (manifest or bare HTML/JS/CSS — NOT workspace root \".\")",
        ),
      checks: z
        .enum(["all", "test", "build", "lint"])
        .optional()
        .describe("Which checks to run (default: all applicable)"),
    }),
  },
);
