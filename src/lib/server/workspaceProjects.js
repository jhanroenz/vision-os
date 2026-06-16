import fs from "node:fs/promises";
import path from "node:path";
import { detectProjectRoot, fileExists } from "./codebase/context.js";
import { config } from "./config.js";
import { resolveSafePath, sanitizeWorkspaceRelativePath } from "./workspace.js";

const IGNORE_DIR_NAMES = new Set([
  ".cursor",
  ".jarvis",
  "node_modules",
  "Stash",
]);

const STRAY_ROOT_DIRS = new Set(["src", "lib", "app", "components", "dist"]);

const STACK_DEPS = {
  vue: ["vue", "@vitejs/plugin-vue", "nuxt"],
  react: ["react", "react-dom", "next"],
  svelte: ["svelte", "@sveltejs/kit"],
  python: ["django", "flask", "fastapi"],
};

async function readPackageProfile(projectPath) {
  const pkgPath = resolveSafePath(path.join(projectPath, "package.json"));
  if (!(await fileExists(pkgPath))) {
    return { packageName: null, keywords: [], stacks: [] };
  }
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    const depNames = Object.keys(deps).join(" ").toLowerCase();
    const stacks = [];
    for (const [stack, markers] of Object.entries(STACK_DEPS)) {
      if (markers.some((m) => depNames.includes(m))) stacks.push(stack);
    }
    return {
      packageName: pkg.name ?? null,
      keywords: Array.isArray(pkg.keywords) ? pkg.keywords : [],
      stacks,
    };
  } catch {
    return { packageName: null, keywords: [], stacks: [] };
  }
}

async function enrichProjectEntry(entry, root, name) {
  const full = path.join(root, name);
  const profile = entry.isProject ? await readPackageProfile(entry.path) : {
    packageName: null,
    keywords: [],
    stacks: [],
  };

  let modifiedAt = null;
  try {
    modifiedAt = (await fs.stat(full)).mtimeMs;
  } catch {
    // ignore
  }

  const entryHints = [];
  if (entry.isProject) {
    for (const hint of ["src/App.vue", "src/main.ts", "src/index.js", "main.py"]) {
      if (await fileExists(path.join(full, hint))) entryHints.push(hint);
    }
  }

  return {
    ...entry,
    ...profile,
    entryHints,
    modifiedAt,
  };
}

/**
 * @typedef {{
 *   name: string,
 *   path: string,
 *   projectType: string|null,
 *   marker: string|null,
 *   isProject: boolean,
 *   isOrphan: boolean,
 *   packageName: string|null,
 *   keywords: string[],
 *   stacks: string[],
 *   entryHints: string[],
 *   modifiedAt: number|null,
 * }} WorkspaceEntry
 */

function normalizeDescriptor(descriptor) {
  return String(descriptor ?? "")
    .trim()
    .replace(/^(?:a|an|the|my)\s+/i, "")
    .trim();
}

export function slugifyProjectName(text) {
  let s = normalizeDescriptor(String(text ?? ""))
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!s) return "new-app";
  if (s.length > 48) s = s.slice(0, 48).replace(/-$/, "");

  if (!/(?:^|-)(app|api|site|project)$/.test(s)) {
    s = `${s}-app`;
  }

  return s;
}

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/**
 * Pull a human descriptor from "create a X app" style prompts.
 */
export function extractAppDescriptor(message) {
  const text = String(message ?? "").trim();
  if (!text) return null;

  const patterns = [
    /\b(?:create|build|make|scaffold|generate|init|develop)(?:\s+me)?\s+(?:a|an|the|new|my)?\s*(?:simple\s+)?(.+?)\s+(?:web\s+)?(?:app|application|project|site|api)\b/i,
    /\b(?:create|build|make|scaffold|generate|init)(?:\s+me)?\s+(?:a|an|the|new|my)?\s*([a-zA-Z][a-zA-Z0-9\s-]{1,48})\s*$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const descriptor = normalizeDescriptor(
        match[1]
          .trim()
          .replace(/\b(new|basic|small|mini)\b/gi, "")
          .trim(),
      );
      if (descriptor && !/^(it|this|that|one|me)$/i.test(descriptor)) {
        return descriptor;
      }
    }
  }

  return null;
}

const ADJECTIVE_FOLDER_NAMES = new Set(["simple", "basic", "mini", "small"]);

function findFolderNamedInMessage(message, inventory) {
  const text = String(message ?? "");
  for (const entry of inventory) {
    if (!entry.isProject && entry.isOrphan) continue;
    const name = entry.name;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const asWord = new RegExp(`\\b${escaped}\\b`, "i");
    if (!asWord.test(text)) continue;

    if (ADJECTIVE_FOLDER_NAMES.has(name.toLowerCase())) {
      const asLocation = new RegExp(
        `\\b(?:in|at|under|inside|from|folder|directory|dir|project)\\s+${escaped}\\b|\\b${escaped}\\s+(?:folder|directory|project|app)\\b|/${escaped}(?:/|\\b)`,
        "i",
      );
      const asAdjective = new RegExp(
        `\\b(?:a|an|the|very|pretty|really)?\\s*${escaped}\\s+(?!folder|directory|project\\b)[a-z]`,
        "i",
      );
      if (asAdjective.test(text) && !asLocation.test(text)) continue;
    }

    return entry;
  }
  return null;
}

export function wantsFreshProject(message) {
  return /\b(new|fresh|another|separate|different)\s+(?:folder|directory|project|app)\b/i.test(
    String(message ?? ""),
  );
}

/** @deprecated Server no longer auto-picks folder names from keywords — agent decides. */
export function inferCanonicalDirName(_message) {
  return null;
}

/**
 * List top-level workspace entries and classify as projects vs orphans.
 * @returns {Promise<WorkspaceEntry[]>}
 */
export async function scanWorkspaceProjects() {
  const root = resolveSafePath(".");
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const name = ent.name;
    if (name.startsWith(".") || IGNORE_DIR_NAMES.has(name)) continue;

    const rel = sanitizeWorkspaceRelativePath(name);
    const detected = await detectProjectRoot(rel);
    const isOrphan =
      STRAY_ROOT_DIRS.has(name) &&
      !detected.projectRoot &&
      !(await fileExists(path.join(root, name, "package.json")));

    results.push(
      await enrichProjectEntry(
        {
          name,
          path: rel,
          projectType: detected.projectType,
          marker: detected.marker,
          isProject: Boolean(detected.projectRoot),
          isOrphan,
        },
        root,
        name,
      ),
    );
  }

  results.sort((a, b) => {
    if (a.isProject !== b.isProject) return a.isProject ? -1 : 1;
    if (a.isOrphan !== b.isOrphan) return a.isOrphan ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return results;
}

function scoreNameMatch(descriptor, entry) {
  const descTokens = tokenize(descriptor);
  const nameTokens = tokenize(entry.name.replace(/-app$/, ""));
  if (!descTokens.length || !nameTokens.length) return 0;

  let score = 0;
  for (const dt of descTokens) {
    for (const nt of nameTokens) {
      if (dt === nt) score += 3;
      else if (dt.startsWith(nt) || nt.startsWith(dt)) score += 2;
      else if (dt.includes(nt) || nt.includes(dt)) score += 1;
    }
  }

  const slug = slugifyProjectName(descriptor).replace(/-app$/, "");
  if (entry.name === slug || entry.name === `${slug}-app`) score += 5;
  if (entry.name.replace(/-app$/, "") === slug) score += 4;

  return score;
}

/**
 * Decide which project folder to use or create for a scaffold request.
 * @returns {Promise<{ action: 'use_existing'|'create', dir: string, reason: string, inventory: WorkspaceEntry[] }>}
 */
export async function resolveScaffoldTarget(message, { explicitPath = null } = {}) {
  const inventory = await scanWorkspaceProjects();
  const projects = inventory.filter((e) => e.isProject && !e.isOrphan);
  const fresh = wantsFreshProject(message);

  const namedFolder = findFolderNamedInMessage(message, inventory);
  if (namedFolder && !fresh) {
    return {
      action: "use_existing",
      dir: namedFolder.path,
      reason: `Message names existing folder "${namedFolder.path}/".`,
      inventory,
    };
  }

  if (explicitPath) {
    const dir = sanitizeWorkspaceRelativePath(explicitPath);
    const existing = inventory.find((e) => e.path === dir || e.name === dir);
    if (existing?.isProject && !fresh) {
      return {
        action: "use_existing",
        dir,
        reason: `Master Jan named folder "${dir}" — using existing project.`,
        inventory,
      };
    }
    return {
      action: "create",
      dir,
      reason: `Master Jan named folder "${dir}" — creating project directory.`,
      inventory,
    };
  }

  const canonical = inferCanonicalDirName(message);
  if (canonical) {
    const hit = inventory.find((e) => e.name === canonical);
    if (hit?.isProject && !fresh) {
      return {
        action: "use_existing",
        dir: canonical,
        reason: `Existing project "${canonical}" matches this request.`,
        inventory,
      };
    }
    const emptyDir = inventory.find((e) => e.name === canonical && !e.isProject);
    if (emptyDir && !fresh) {
      return {
        action: "use_existing",
        dir: canonical,
        reason: `Folder "${canonical}" exists — scaffolds inside it.`,
        inventory,
      };
    }
    return {
      action: "create",
      dir: canonical,
      reason: `Scaffold target "${canonical}" from request keywords.`,
      inventory,
    };
  }

  const descriptor = extractAppDescriptor(message);
  if (descriptor) {
    const slug = slugifyProjectName(descriptor);
    const exact = inventory.find((e) => e.name === slug);
    if (exact && !fresh) {
      return {
        action: exact.isProject ? "use_existing" : "use_existing",
        dir: slug,
        reason: exact.isProject
          ? `Project folder "${slug}" already exists at workspace root.`
          : `Folder "${slug}" exists — scaffolds inside it.`,
        inventory,
      };
    }

    if (!fresh && projects.length) {
      let best = null;
      let bestScore = 0;
      for (const p of projects) {
        const score = scoreNameMatch(descriptor, p);
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
      if (best && bestScore >= 4) {
        return {
          action: "use_existing",
          dir: best.path,
          reason: `Existing project "${best.path}" matches "${descriptor}" (score ${bestScore}).`,
          inventory,
        };
      }
    }

    return {
      action: "create",
      dir: slug,
      reason: `New project "${slug}" from "${descriptor}".`,
      inventory,
    };
  }

  if (!fresh && projects.length === 1) {
    return {
      action: "use_existing",
      dir: projects[0].path,
      reason: `Only one project in workspace ("${projects[0].path}") — using it.`,
      inventory,
    };
  }

  return {
    action: "create",
    dir: "new-app",
    reason: "Could not infer a name — defaulting to new-app/.",
    inventory,
  };
}

export function formatWorkspaceProjectsBlock(
  inventory,
  {
    activeProject = null,
    scaffoldNote = null,
    ranked = [],
    intent = null,
    confidence = null,
  } = {},
) {
  const lines = [
    "Multi-project workspace (Cursor-style — server picks target from cwd, history, and message):",
    `- Workspace: ${config.workspaceDir}`,
  ];

  if (intent) lines.push(`- Turn intent: ${intent}`);
  if (confidence) lines.push(`- Target confidence: ${confidence}`);

  const projects = inventory.filter((e) => e.isProject && !e.isOrphan);
  const orphans = inventory.filter((e) => e.isOrphan);
  const other = inventory.filter((e) => !e.isProject && !e.isOrphan);

  const rankMap = new Map(ranked.map((r, i) => [r.path, { ...r, rank: i + 1 }]));

  if (projects.length) {
    lines.push("- Projects:");
    for (const p of projects) {
      const type = p.projectType ? ` (${p.projectType})` : "";
      const stacks = p.stacks?.length ? ` [${p.stacks.join(", ")}]` : "";
      const pkg = p.packageName ? ` pkg:${p.packageName}` : "";
      const rank = rankMap.get(p.path);
      const marker =
        activeProject === p.path
          ? " ★ ACTIVE"
          : rank
            ? ` (score ${rank.score})`
            : "";
      lines.push(`  • ${p.path}/${type}${stacks}${pkg}${marker}`);
      if (rank?.signals?.length) {
        lines.push(`      signals: ${rank.signals.slice(0, 3).join("; ")}`);
      }
    }
  } else {
    lines.push("- Projects: (none detected yet)");
  }

  if (other.length) {
    lines.push("- Empty / partial folders:");
    for (const p of other) {
      lines.push(`  • ${p.path}/`);
    }
  }

  if (orphans.length) {
    lines.push("- ORPHAN at workspace root (never write app code here):");
    for (const p of orphans) {
      lines.push(`  • ${p.path}/`);
    }
  }

  if (activeProject && activeProject !== ".") {
    lines.push(
      `- ACTIVE PROJECT: ${activeProject}/`,
      `- ALL code paths MUST use prefix ${activeProject}/`,
    );
  } else {
    lines.push(
      "- ACTIVE PROJECT: none — inspect_codebase on a folder before write_file, or let scaffold create one.",
    );
  }

  if (scaffoldNote) {
    lines.push(`- Decision: ${scaffoldNote}`);
  }

  if (ranked.length > 1 && activeProject) {
    const alts = ranked.filter((r) => r.path !== activeProject).slice(0, 2);
    if (alts.length) {
      lines.push(
        `- Alternatives considered: ${alts.map((a) => `${a.path} (${a.score})`).join(", ")}`,
      );
    }
  }

  return lines.join("\n");
}
