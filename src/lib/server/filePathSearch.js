/**
 * Resolve workspace file paths by name, substring, or simple glob.
 */

function normalizePath(p) {
  return String(p ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function basename(p) {
  const n = normalizePath(p);
  const i = n.lastIndexOf("/");
  return i === -1 ? n : n.slice(i + 1);
}

function globToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = escaped
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`, "i");
}

/**
 * @param {string} workspacePath — e.g. ./vue-app/src/App.vue or vue-app/src/App.vue
 * @param {string} query
 */
export function scorePathMatch(workspacePath, query) {
  const path = normalizePath(workspacePath.replace(/^\.\//, ""));
  const q = normalizePath(query);
  if (!path || !q) return 0;

  if (path === q) return 100;
  if (path.endsWith(`/${q}`)) return 95;

  const pathBase = basename(path);
  const qBase = basename(q);

  if (pathBase.toLowerCase() === qBase.toLowerCase()) return 90;

  if (q.includes("*") || q.includes("?")) {
    try {
      if (globToRegex(q).test(path) || globToRegex(q).test(pathBase)) return 80;
    } catch {
      // ignore bad glob
    }
  }

  if (path.toLowerCase().includes(q.toLowerCase())) return 70;
  if (qBase.length > 2 && pathBase.toLowerCase().includes(qBase.toLowerCase())) return 60;

  return 0;
}

/**
 * @param {string[]} paths
 * @param {string} query
 * @param {number} [maxResults]
 */
export function searchFilePaths(paths, query, maxResults = 25) {
  const limit = Math.min(Math.max(maxResults, 1), 100);
  const seen = new Set();

  return paths
    .map((raw) => {
      const workspacePath = normalizePath(String(raw).replace(/^\.\//, ""));
      return {
        workspacePath,
        displayPath: workspacePath.startsWith("./")
          ? workspacePath
          : `./${workspacePath}`,
        score: scorePathMatch(workspacePath, query),
      };
    })
    .filter((row) => row.score > 0 && !seen.has(row.workspacePath) && seen.add(row.workspacePath))
    .sort((a, b) => b.score - a.score || a.workspacePath.localeCompare(b.workspacePath))
    .slice(0, limit);
}

/**
 * Path relative to agent cwd (for tool args when cwd is the project root).
 */
export function pathRelativeToCwd(workspacePath, cwd) {
  const path = normalizePath(workspacePath);
  const base = normalizePath(cwd);
  if (!base || base === ".") return path;
  if (path === base) return ".";
  if (path.startsWith(`${base}/`)) return path.slice(base.length + 1);
  return null;
}

/**
 * @param {{
 *   query: string,
 *   cwd: string,
 *   scanRoot: string,
 *   matches: Array<{ workspacePath: string, displayPath: string, score: number }>,
 *   truncated?: boolean,
 * }} ctx
 */
export function formatSearchFilesResult(ctx) {
  const { query, cwd, scanRoot, matches, truncated = false } = ctx;
  const cwdNorm = normalizePath(cwd) || ".";

  if (!matches.length) {
    return [
      "RESULT: SUCCESS (exit 0)",
      `Query: ${query}`,
      `Agent cwd: ${cwdNorm}`,
      `Scan root: ${scanRoot}`,
      "",
      `No files matching "${query}" under scan root "${scanRoot}".`,
      "Greenfield confirmed — target files do not exist yet.",
      "Phase 1 AWARENESS is satisfied. Proceed to update_task_plan, then write_file for new files.",
      "Do not repeat search_files for paths you plan to create.",
      "Use list_directory if you need folder names under the scan root.",
    ].join("\n");
  }

  const lines = [
    "RESULT: SUCCESS (exit 0)",
    `Query: ${query}`,
    `Agent cwd: ${cwdNorm}`,
    `Scan root: ${scanRoot}`,
    "",
    "Workspace-relative paths (use in read_file / write_file / search_replace):",
  ];

  for (const m of matches) {
    lines.push(`  ${m.workspacePath}`);
    const relCwd = pathRelativeToCwd(m.workspacePath, cwdNorm);
    if (relCwd && relCwd !== m.workspacePath) {
      lines.push(`    → from cwd: ${relCwd}`);
    }
  }

  if (truncated) {
    lines.push("", "… more matches omitted — narrow your query");
  }

  lines.push(
    "",
    "Copy the workspace-relative path exactly — do not invent locations.",
  );

  return lines.join("\n");
}

/** Whether a tool_result from search_files includes this target path. */
export function searchResultCoversPath(resultContent, targetPath) {
  const target = normalizePath(targetPath);
  if (!target) return false;
  const text = String(resultContent ?? "");
  if (!/RESULT:\s*SUCCESS/i.test(text)) return false;

  const targetBase = basename(target);
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("→")) continue;
    const candidate = normalizePath(trimmed.replace(/^\.\//, ""));
    if (candidate === target) return true;
    if (candidate.endsWith(`/${target}`)) return true;
    if (basename(candidate).toLowerCase() === targetBase.toLowerCase()) return true;
  }
  return false;
}
