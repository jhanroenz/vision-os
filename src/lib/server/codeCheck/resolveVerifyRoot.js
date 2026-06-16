import path from "node:path";
import { detectProjectRoot } from "../codebase/context.js";
import { getActiveProjectRoot, getLockedProjectRoot } from "../workspace.js";
import { getWrittenFiles } from "../actionTracker.js";
import { getFileContextState } from "../fileContext.js";
import { detectBareProject } from "./bareProject.js";

export const PROJECT_MARKER_FILES = [
  "package.json",
  "pyproject.toml",
  "setup.py",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "Gemfile",
  "composer.json",
];

function uniqueHints(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    const normalized = String(p ?? "")
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .replace(/^\.\//, "");
    if (!normalized || normalized === ".") continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function topLevelFromPath(filePath) {
  const normalized = String(filePath ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  const slash = normalized.indexOf("/");
  return slash > 0 ? normalized.slice(0, slash) : null;
}

/**
 * @param {string} normalizedPath
 */
async function tryBareAtPath(normalizedPath) {
  const bare = await detectBareProject(normalizedPath);
  if (!bare) return null;

  return {
    projectRoot: bare.projectRoot,
    projectType: "bare",
    stack: bare.stack,
    marker: null,
    resolvedFrom: normalizedPath,
  };
}

/**
 * Candidate project folders for verify_project — used to sync agent path and error hints.
 * @param {string | null | undefined} threadId
 * @returns {string[]}
 */
export function collectVerifyPathHints(threadId) {
  if (!threadId) return [];

  return uniqueHints([
    getLockedProjectRoot(threadId),
    getActiveProjectRoot(threadId),
    ...getFileContextState(threadId).mentionedProjects,
    ...getWrittenFiles(threadId).map(topLevelFromPath).filter(Boolean),
  ]);
}

/**
 * Best project folder path to pass to verify_project when the agent omits path or uses ".".
 * @param {string | null | undefined} threadId
 */
export async function inferVerifyProjectPath(threadId) {
  const detected = await resolveVerifyProjectRoot(".", threadId);
  return detected.projectRoot ?? null;
}

/**
 * Resolve project root for verify_project (manifest or bare HTML/JS/CSS).
 * @param {string} startPath — path the agent passed (may be ".")
 * @param {string | null | undefined} threadId
 */
export async function resolveVerifyProjectRoot(startPath = ".", threadId = null) {
  const normalizedStart = String(startPath ?? ".").replace(/\\/g, "/") || ".";
  const agentUsedWorkspaceRoot = normalizedStart === ".";

  let detected = await detectProjectRoot(normalizedStart);
  if (detected.projectRoot) {
    return {
      ...detected,
      resolvedFrom: normalizedStart,
      inferred: agentUsedWorkspaceRoot,
    };
  }

  if (agentUsedWorkspaceRoot) {
    if (threadId) {
      const hints = [
        ...collectVerifyPathHints(threadId),
        ...getWrittenFiles(threadId),
      ];

      for (const hint of uniqueHints(hints)) {
        detected = await detectProjectRoot(hint);
        if (detected.projectRoot) {
          return { ...detected, resolvedFrom: hint, inferred: true };
        }

        const bareHint = await tryBareAtPath(hint);
        if (bareHint) {
          return { ...bareHint, inferred: true };
        }
      }

      for (const filePath of getWrittenFiles(threadId)) {
        const parent = path.dirname(filePath.replace(/\\/g, "/"));
        if (!parent || parent === ".") continue;

        detected = await detectProjectRoot(parent);
        if (detected.projectRoot) {
          return { ...detected, resolvedFrom: parent, inferred: true };
        }

        const bareParent = await tryBareAtPath(parent);
        if (bareParent) {
          return { ...bareParent, inferred: true };
        }
      }
    }

    const bareWorkspace = await tryBareAtPath(".");
    if (bareWorkspace) {
      return { ...bareWorkspace, resolvedFrom: ".", inferred: true };
    }
  }

  if (normalizedStart !== ".") {
    const bare = await tryBareAtPath(normalizedStart);
    if (bare) {
      return { ...bare, inferred: agentUsedWorkspaceRoot };
    }
  }

  return {
    projectRoot: null,
    projectType: null,
    marker: null,
    resolvedFrom: normalizedStart,
    inferred: agentUsedWorkspaceRoot,
  };
}

/**
 * @param {string} searchedPath
 * @param {string | null | undefined} threadId
 */
export function buildMissingMarkerMessage(searchedPath, threadId) {
  const hints = collectVerifyPathHints(threadId);
  const lines = [
    "OVERALL: FAIL",
    `"${searchedPath}" is not a recognized project folder.`,
    "Expected a manifest (package.json, Cargo.toml, pyproject.toml, …) " +
      "or bare HTML/JS/CSS sources (index.html, .js, .css).",
    "Pass the project folder path in verify_project — not workspace root \".\".",
  ];

  if (hints.length) {
    lines.push(`Suggested path from this turn: {"path":"${hints[0]}"}`);
    if (hints.length > 1) {
      lines.push(`Other candidates: ${hints.slice(1).join(", ")}`);
    }
  } else {
    lines.push('Example: {"tool":"verify_project","args":{"path":"my-site"}}');
  }

  lines.push(
    "For bare sites without package.json, place index.html + assets in that folder, " +
    "or call check_syntax on each file.",
  );

  return lines.join("\n");
}
