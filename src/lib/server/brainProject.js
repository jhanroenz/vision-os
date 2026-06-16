/** Normalize workspace project root to a single brain scope slug (e.g. "portfolio"). */
export function normalizeBrainProject(value) {
  if (value == null) return null;
  const raw = String(value).trim().replace(/\\/g, "/");
  if (!raw || raw === "." || /^global$/i.test(raw)) return null;

  const stripped = raw.replace(/^\/+|\/+$/g, "");
  if (!stripped) return null;

  const segment = stripped.split("/").filter(Boolean)[0];
  return segment || null;
}

/** Whether a brain row is visible for the given active project scope. */
export function memoryMatchesProjectScope(rowProject, activeProject) {
  const scope = normalizeBrainProject(activeProject);
  const itemProject = normalizeBrainProject(rowProject);
  if (!scope) return itemProject === null;
  return itemProject === null || itemProject === scope;
}

export function projectScopeLabel(project) {
  const normalized = normalizeBrainProject(project);
  return normalized ?? "global";
}

export function buildProjectScopeSql(activeProject, { column = "project" } = {}) {
  const scope = normalizeBrainProject(activeProject);
  if (!scope) {
    return { clause: `${column} IS NULL`, params: [] };
  }
  return {
    clause: `(${column} IS NULL OR ${column} = ?)`,
    params: [scope],
  };
}
