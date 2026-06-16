/**
 * Lightweight path helpers — no workspace/config imports.
 */

export function normalizePath(p) {
  return String(p ?? ".")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "") || ".";
}

const PROJECT_INTERNAL_PREFIX =
  /^(src|lib|app|tests?|components|pages|views|public|server|client|api|dist|build|styles|assets)\//;

export function looksProjectInternal(relativePath) {
  return PROJECT_INTERNAL_PREFIX.test(normalizePath(relativePath));
}

/** todo/todo/package.json → todo/package.json when project is todo */
export function dedupeProjectPrefix(rawPath, projectRoot) {
  const raw = normalizePath(rawPath);
  const project = projectRoot && projectRoot !== "." ? normalizePath(projectRoot) : null;
  if (!project) return raw;

  const parts = raw.split("/");
  if (parts[0] === project && parts[1] === project) {
    return [project, ...parts.slice(2)].join("/");
  }
  if (raw.startsWith(`${project}/`)) return raw;
  return raw;
}
