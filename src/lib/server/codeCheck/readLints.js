import path from "node:path";
import fs from "node:fs/promises";
import { detectProjectRoot, fileExists } from "../codebase/context.js";
import { resolveSafePath } from "../workspace.js";
import { executeShellCommand, formatCommandResult } from "../shellExec.js";

async function readPackageMeta(projectRoot) {
  const pkgPath = resolveSafePath(path.join(projectRoot, "package.json"));
  if (!(await fileExists(pkgPath))) return null;
  try {
    return JSON.parse(await fs.readFile(pkgPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * @returns {Array<{ name: string, command: string, timeout?: number }>}
 */
export async function resolveLintCommands(projectRoot, projectType, targetRel) {
  const target = targetRel && targetRel !== "." ? targetRel : ".";
  const commands = [];

  if (projectType === "node") {
    const pkg = await readPackageMeta(projectRoot);
    const scripts = pkg?.scripts ?? {};
    const root = resolveSafePath(projectRoot);

    const hasEslint =
      scripts.lint ||
      (await fileExists(resolveSafePath(path.join(projectRoot, ".eslintrc.cjs")))) ||
      (await fileExists(resolveSafePath(path.join(projectRoot, "eslint.config.js")))) ||
      (await fileExists(resolveSafePath(path.join(projectRoot, ".eslintrc.js"))));

    const hasVue =
      (await fileExists(resolveSafePath(path.join(projectRoot, "src/App.vue")))) ||
      pkg?.dependencies?.vue ||
      pkg?.devDependencies?.vue;

    const hasTs = await fileExists(resolveSafePath(path.join(projectRoot, "tsconfig.json")));

    if (scripts.lint && !scripts.lint.includes("no test specified")) {
      commands.push({
        name: "lint",
        command: `npm run lint -- ${JSON.stringify(target)}`,
        timeout: 90,
      });
    } else if (hasEslint) {
      commands.push({
        name: "eslint",
        command: `npx eslint ${JSON.stringify(target)} --max-warnings 0`,
        timeout: 90,
      });
    }

    if (scripts.typecheck) {
      commands.push({
        name: "typecheck",
        command: "npm run typecheck",
        timeout: 90,
      });
    } else if (scripts.check && !scripts.typecheck) {
      commands.push({ name: "check", command: "npm run check", timeout: 90 });
    } else if (hasVue && hasTs) {
      commands.push({
        name: "vue-tsc",
        command: "npx vue-tsc --noEmit",
        timeout: 90,
      });
    } else if (hasTs) {
      commands.push({
        name: "tsc",
        command: "npx tsc --noEmit",
        timeout: 90,
      });
    }

    if (!commands.length && (await fileExists(path.join(root, "node_modules")))) {
      commands.push({
        name: "eslint",
        command: `npx eslint ${JSON.stringify(target)} --max-warnings 0`,
        timeout: 90,
      });
    }
  } else if (projectType === "python") {
    const root = resolveSafePath(projectRoot);
    if (
      (await fileExists(path.join(root, "ruff.toml"))) ||
      (await fileExists(resolveSafePath(path.join(projectRoot, "pyproject.toml"))))
    ) {
      commands.push({
        name: "ruff",
        command: `python -m ruff check ${JSON.stringify(target)}`,
        timeout: 60,
      });
    } else {
      commands.push({
        name: "compile",
        command: `python -m compileall -q ${JSON.stringify(target)}`,
        timeout: 60,
      });
    }
  } else if (projectType === "rust") {
    commands.push({ name: "cargo-check", command: "cargo check", timeout: 120 });
  } else if (projectType === "go") {
    commands.push({ name: "go-vet", command: "go vet ./...", timeout: 60 });
  }

  return commands;
}

/**
 * @param {string} targetPath workspace-relative file or directory
 */
export async function runReadLints(targetPath) {
  const detected = await detectProjectRoot(targetPath);
  const lines = [`read_lints: ${targetPath}`];

  if (!detected.projectRoot) {
    lines.push(
      "RESULT: FAILED (exit 1)",
      "No project root detected for this path.",
      "Use check_syntax for universal parse/markup checks on individual files.",
    );
    return lines.join("\n");
  }

  const projectRoot = detected.projectRoot;
  const absTarget = resolveSafePath(targetPath);
  const relFromProject =
    path
      .relative(resolveSafePath(projectRoot), absTarget)
      .replace(/\\/g, "/") || ".";

  const commands = await resolveLintCommands(
    projectRoot,
    detected.projectType,
    relFromProject,
  );

  if (!commands.length) {
    lines.push(
      "RESULT: SUCCESS (exit 0)",
      "No project linter configured for this stack.",
      "Use check_syntax for parse errors or run_check with a known script.",
    );
    return lines.join("\n");
  }

  lines.push(`Project: ${projectRoot} (${detected.projectType})`);

  let anyFail = false;
  for (const spec of commands) {
    const result = await executeShellCommand({
      command: spec.command,
      cwd: projectRoot,
      timeout: spec.timeout ?? 90,
    });
    lines.push("");
    lines.push(`--- ${spec.name} ---`);
    lines.push(
      formatCommandResult({
        ...result,
        label: spec.name,
      }),
    );
    if (!result.success) anyFail = true;
  }

  lines.unshift("");
  lines.unshift(anyFail ? "RESULT: FAILED (exit 1)" : "RESULT: SUCCESS (exit 0)");

  return lines.join("\n");
}
