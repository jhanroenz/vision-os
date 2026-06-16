import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { resolveSafePath } from "../workspace.js";
import {
  inferStackFromFiles,
  SCAFFOLD_INIT_HINTS,
  stackToProjectType,
} from "../stackHints.js";

const templatesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
);

const PROJECT_MARKERS = [
  { file: "package.json", type: "node" },
  { file: "pyproject.toml", type: "python" },
  { file: "Cargo.toml", type: "rust" },
  { file: "go.mod", type: "go" },
  { file: "pom.xml", type: "java" },
  { file: "Gemfile", type: "ruby" },
  { file: "composer.json", type: "php" },
];

const ENTRY_HINTS = {
  node: ["src/main.ts", "src/main.js", "src/index.ts", "src/index.js", "src/App.vue"],
  python: ["main.py", "app/__init__.py", "src/main.py"],
  rust: ["src/main.rs", "src/lib.rs"],
  go: ["main.go", "cmd/"],
  java: ["src/main/java", "pom.xml"],
  php: ["index.php", "public/index.php"],
  generic: ["README.md", "src/"],
};

export function getTemplatesDir() {
  return templatesDir;
}

export function workspaceRelative(absPath) {
  const workspace = resolveSafePath(".");
  return path.relative(workspace, absPath).replace(/\\/g, "/") || ".";
}

export async function fileExists(fullPath) {
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

export async function detectProjectRoot(startRelative = ".") {
  const workspace = resolveSafePath(".");
  let current = resolveSafePath(startRelative);

  while (current.startsWith(workspace + path.sep) || current === workspace) {
    for (const marker of PROJECT_MARKERS) {
      if (await fileExists(path.join(current, marker.file))) {
        const root = path.relative(workspace, current).replace(/\\/g, "/") || ".";
        return { projectRoot: root, projectType: marker.type, marker: marker.file };
      }
    }

    if (await fileExists(path.join(current, ".git"))) {
      const root = path.relative(workspace, current).replace(/\\/g, "/") || ".";
      return { projectRoot: root, projectType: "generic", marker: ".git" };
    }

    if (current === workspace) break;
    current = path.dirname(current);
  }

  return { projectRoot: null, projectType: null, marker: null };
}

export async function findProjectRoot(startRelative = ".") {
  const { projectRoot } = await detectProjectRoot(startRelative);
  return projectRoot;
}

export async function listProjectFiles(projectRoot, maxDepth = 3) {
  const root = resolveSafePath(projectRoot);
  const lines = [];

  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      lines.push(`${entry.isDirectory() ? "dir" : "file"}  ${rel}`);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      }
    }
  }

  await walk(root, 0);
  return lines.join("\n") || "(empty project)";
}

async function readPackageMeta(projectRoot) {
  const pkgPath = resolveSafePath(path.join(projectRoot, "package.json"));
  if (!(await fileExists(pkgPath))) return null;
  try {
    return JSON.parse(await fs.readFile(pkgPath, "utf-8"));
  } catch {
    return null;
  }
}

async function findEntryHints(projectRoot, projectType) {
  const hints = ENTRY_HINTS[projectType] ?? ENTRY_HINTS.generic;
  const found = [];
  for (const hint of hints) {
    const full = resolveSafePath(path.join(projectRoot, hint));
    if (await fileExists(full)) found.push(hint);
  }
  return found;
}

export async function describeCodebase(startRelative = ".") {
  const normalized = (startRelative || ".").replace(/\\/g, "/").replace(/\/+$/, "") || ".";
  const absPath = resolveSafePath(normalized);

  let dirExists = false;
  try {
    const stat = await fs.stat(absPath);
    dirExists = stat.isDirectory();
  } catch {
    dirExists = false;
  }

  if (!dirExists) {
    return {
      projectRoot: null,
      projectType: null,
      scaffold: false,
      message:
        `Directory "${normalized}" does not exist.\n` +
        `Create it first: run_bash { "command": "mkdir -p ${normalized}" }\n` +
        `Then scaffold with non-interactive init (npm init -y, write_file entry files, npm install).`,
    };
  }

  const detected = await detectProjectRoot(normalized);
  if (detected.projectRoot) {
    const { projectRoot, projectType } = detected;
    const pkg = await readPackageMeta(projectRoot);
    const files = await listProjectFiles(projectRoot);
    const entryHints = await findEntryHints(projectRoot, projectType);

    return {
      projectRoot,
      projectType,
      marker: detected.marker,
      scaffold: false,
      name: pkg?.name ?? path.basename(projectRoot),
      scripts: pkg?.scripts ?? {},
      entryHints,
      files,
      message:
        `Project root: ${projectRoot} (${projectType}). ` +
        `Resolve paths as ${projectRoot}/… unless already prefixed. ` +
        (entryHints.length
          ? `Likely entry files: ${entryHints.join(", ")}`
          : "Call read_file on likely entry paths before editing."),
    };
  }

  // Scaffold folder: directory exists but no package.json / marker yet
  if (normalized === ".") {
    return {
      projectRoot: null,
      projectType: null,
      scaffold: false,
      message:
        "At workspace root — no project marker here.\n" +
        "Call inspect_codebase on a specific project folder (e.g. my-app), " +
        "or list_directory to see existing folders.\n" +
        "File paths must use the project prefix: my-app/src/main.ts",
    };
  }

  const stackHints = await inferStackFromFiles(absPath);
  const files = await listProjectFiles(normalized);
  const projectType = stackToProjectType(stackHints[0]);
  const initHints = [...new Set(stackHints.map((h) => SCAFFOLD_INIT_HINTS[h]).filter(Boolean))];

  const lines = [
    `Scaffold folder: ${normalized} (directory exists, no project marker yet).`,
    `Active project context set to "${normalized}".`,
    `Resolve ALL file paths as ${normalized}/… (e.g. ${normalized}/package.json, ${normalized}/src/App.vue).`,
  ];

  if (stackHints.length) {
    lines.push(`Files suggest stack: ${stackHints.join(", ")}`);
    if (initHints.length) {
      lines.push("Suggested non-interactive init:");
      for (const hint of initHints) lines.push(`  • ${hint}`);
    }
  } else {
    lines.push(
      "Folder is empty or has no source files yet.",
      "Next: npm init -y (cwd=" + normalized + ") OR write_file package.json + entry files, then npm install.",
    );
  }

  return {
    projectRoot: normalized,
    projectType,
    scaffold: true,
    name: path.basename(normalized),
    scripts: {},
    entryHints: [],
    stackHints,
    files,
    message: lines.join("\n"),
  };
}

export async function copyTemplateFiles(templateName, projectRoot, fileMappings) {
  const templateRoot = path.join(templatesDir, templateName);

  for (const [relDest, relSrc] of Object.entries(fileMappings)) {
    const src = path.join(templateRoot, relSrc);
    const dest = resolveSafePath(path.join(projectRoot, relDest));
    const content = await fs.readFile(src, "utf-8");
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content, "utf-8");
  }
}

export async function buildCodebaseSnapshot(threadId, getThreadCwd, getActiveProjectRoot) {
  const cwd = getThreadCwd(threadId);
  const activeProject = getActiveProjectRoot(threadId);
  const detected = activeProject
    ? { projectRoot: activeProject, ...(await detectProjectRoot(activeProject)) }
    : await detectProjectRoot(cwd);

  const { getScaffoldNote, getWorkspaceInventory, getProjectResolution } = await import(
    "../workspace.js"
  );
  const { formatWorkspaceProjectsBlock, scanWorkspaceProjects } = await import(
    "../workspaceProjects.js"
  );

  const inventory =
    getWorkspaceInventory(threadId) ?? (await scanWorkspaceProjects());
  const resolution = getProjectResolution(threadId);
  const inventoryBlock = formatWorkspaceProjectsBlock(inventory, {
    activeProject: activeProject ?? detected.projectRoot,
    scaffoldNote: getScaffoldNote(threadId),
    ranked: resolution?.ranked ?? [],
    intent: resolution?.intent ?? null,
    confidence: resolution?.confidence ?? null,
  });

  const lines = [
    inventoryBlock,
    "",
    "Codebase context:",
    `- Agent cwd: ${cwd}`,
  ];

  if (detected.projectRoot) {
    lines.push(
      `- Detected project root: ${detected.projectRoot} (${detected.projectType ?? "generic"})`,
      `- Resolve file paths as: ${detected.projectRoot}/… unless explicitly prefixed`,
    );
  } else if (activeProject && activeProject !== ".") {
    const { getLockedProjectRoot } = await import("../workspace.js");
    const locked = getLockedProjectRoot(threadId);
    lines.push(
      locked
        ? `- LOCKED project root: ${locked} — all tools MUST use ${locked}/… paths`
        : `- Active project folder: ${activeProject} (scaffolding — package.json may not exist yet)`,
      `- Resolve file paths as: ${activeProject}/…`,
    );
  } else {
    lines.push(
      "- Detected project root: (none) — inspect_codebase or list_directory before editing code",
    );
  }

  return lines.join("\n");
}

export async function enrichWriteFileResult(
  threadId,
  relativePath,
  bytesWritten,
  getActiveProjectRoot,
) {
  const activeProject = getActiveProjectRoot(threadId);
  const detected = await detectProjectRoot(relativePath);
  const lines = [`Wrote ${bytesWritten} bytes to ${relativePath}`];

  if (detected.projectRoot) {
    lines.push(`Inside project: ${detected.projectRoot}`);
  } else if (/^(src|lib|app)\//.test(relativePath)) {
    lines.push(
      `WARNING: "${relativePath}" is NOT inside a detected project. ` +
        `This likely wrote to workspace root instead of your app folder. ` +
        `Call inspect_codebase, then rewrite using the project prefix.`,
    );
  }

  if (activeProject && !relativePath.startsWith(activeProject === "." ? "" : `${activeProject}/`)) {
    if (activeProject !== "." || !relativePath.includes("/")) {
      lines.push(
        `WARNING: Path is outside active project "${activeProject}". ` +
          `Use ${activeProject}/${relativePath.replace(/^\.\/?/, "")} instead.`,
      );
    }
  }

  if (relativePath.endsWith(".vue")) {
    const fullPath = resolveSafePath(relativePath);
    try {
      const content = await fs.readFile(fullPath, "utf8");
      for (const block of ["template", "style", "script"]) {
        const open = content.match(new RegExp(`<${block}[\\s>]`));
        const close = content.includes(`</${block}>`);
        if (open && !close) {
          lines.push(
            `Tip: ${relativePath} may be missing </${block}> — call check_syntax to validate Vue SFC structure.`,
          );
        }
      }
    } catch {
      // ignore read errors
    }
  }

  return lines.join("\n");
}
