import {
  dedupeProjectPrefix,
  looksProjectInternal,
  normalizePath,
} from "./pathUtils.js";

/** Tools that must stay scoped to the locked project root during a coding job. */
export const PROJECT_SCOPED_TOOLS = new Set([
  "read_file",
  "write_file",
  "search_replace",
  "list_directory",
  "run_bash",
  "grep_code",
  "glob_files",
  "semantic_search",
  "inspect_codebase",
  "detect_stack",
  "inspect_ast",
  "verify_project",
  "apply_template",
  "cleanup_stray_paths",
]);

const PATH_ARG_TOOLS = new Set([
  "read_file",
  "write_file",
  "search_replace",
  "list_directory",
  "grep_code",
  "glob_files",
  "semantic_search",
  "inspect_codebase",
  "detect_stack",
  "inspect_ast",
  "verify_project",
]);

/**
 * Resolve any workspace-relative path to live under projectRoot.
 * @returns {{ path: string, rewritten: boolean }}
 */
export function resolvePathUnderProjectRoot(inputPath, projectRoot) {
  const root = normalizePath(projectRoot);
  if (!root || root === ".") {
    return { path: normalizePath(inputPath), rewritten: false };
  }

  let p = dedupeProjectPrefix(normalizePath(inputPath ?? "."), root);

  if (p === root) return { path: root, rewritten: inputPath !== root };
  if (p.startsWith(`${root}/`)) return { path: p, rewritten: normalizePath(inputPath) !== p };

  // api-server/index.js or src/App.vue → root/...
  const tail = p.replace(/^\.\//, "");
  const resolved = `${root}/${tail}`.replace(/\/+/g, "/");
  return {
    path: resolved,
    rewritten: normalizePath(inputPath) !== resolved,
  };
}

export function formatPathRewriteNote(original, resolved, projectRoot) {
  return (
    `PATH SCOPED to locked project root "${projectRoot}": ` +
    `"${original}" → "${resolved}". ` +
    `All paths for this job MUST stay under "${projectRoot}/".`
  );
}

export function formatOutsideProjectRootError(path, projectRoot, toolName) {
  return (
    `BLOCKED ${toolName}: path "${path}" is outside the locked project root "${projectRoot}".\n` +
    `This job uses ONE project directory only. ` +
    `Use paths like "${projectRoot}/src/..." or "${projectRoot}/package.json".\n` +
    `Do NOT create sibling project folders or write bare src/ at workspace root.`
  );
}

/**
 * @returns {{ path: string, rewritten: boolean, message?: string } | { error: string }}
 */
export function enforceProjectPath(toolName, inputPath, projectRoot) {
  if (!PATH_ARG_TOOLS.has(toolName) || !projectRoot || projectRoot === ".") {
    return { path: normalizePath(inputPath ?? "."), rewritten: false };
  }

  const original = normalizePath(inputPath ?? ".");
  const { path: resolved, rewritten } = resolvePathUnderProjectRoot(original, projectRoot);

  if (!resolved.startsWith(`${projectRoot}/`) && resolved !== projectRoot) {
    return { error: formatOutsideProjectRootError(original, projectRoot, toolName) };
  }

  return {
    path: resolved,
    rewritten,
    message: rewritten ? formatPathRewriteNote(original, resolved, projectRoot) : undefined,
  };
}

export function defaultScopedPath(projectRoot, explicitPath) {
  const root = normalizePath(projectRoot);
  if (!root || root === ".") return normalizePath(explicitPath ?? ".");
  if (!explicitPath || explicitPath === ".") return root;
  return resolvePathUnderProjectRoot(explicitPath, root).path;
}

export const PROJECT_ROOT_PROMPT_RULE = `LOCKED PROJECT ROOT (server-enforced — mandatory for this coding job):
- ONE workspace directory is locked as the project root for this conversation turn / job.
- Prefer project-relative paths: package.json, src/main.js (server auto-prefixes with the locked root).
- Do NOT repeat the project folder in every path (wrong: my-app/my-app/src — use my-app/src or src/ when cwd is locked).
- run_bash cwd defaults to the locked project root — use mkdir -p src, not mkdir my-app/src.
- inspect_codebase, verify_project, grep_code, glob_files, and semantic_search are scoped to the locked root.
- FORBIDDEN: creating a second top-level project folder or bare src/ at workspace root.
- New projects: you choose the folder name (mkdir or write_file). inspect_codebase locks the root after you pick a folder — server does not mkdir for you.`;
