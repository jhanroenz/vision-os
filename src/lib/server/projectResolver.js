import {
  extractAppDescriptor,
  inferCanonicalDirName,
  scanWorkspaceProjects,
  slugifyProjectName,
  wantsFreshProject,
} from "./workspaceProjects.js";
import { sanitizeWorkspaceRelativePath } from "./workspace.js";

const STACK_DEPS = {
  vue: ["vue", "@vitejs/plugin-vue", "nuxt", "vitepress"],
  react: ["react", "react-dom", "next", "gatsby"],
  svelte: ["svelte", "@sveltejs/kit"],
  python: ["django", "flask", "fastapi"],
};

/** @typedef {'scaffold_new'|'extend'|'explore'|'continue'} WorkspaceIntent */

/**
 * Classify how this turn relates to workspace projects (Cursor-style routing).
 * @param {string} message
 * @param {string} [turnProfile]
 * @returns {WorkspaceIntent}
 */
export function classifyWorkspaceIntent(message, turnProfile = "code") {
  const text = String(message ?? "");

  if (turnProfile === "explore") return "explore";

  if (
    /\b(create|scaffold|init|generate|bootstrap)\b/i.test(text) &&
    /\b(app|application|project|site|api|repo)\b/i.test(text)
  ) {
    return "scaffold_new";
  }

  if (
    /\b(build|make)\b/i.test(text) &&
    /\b(app|application|project|site|api)\b/i.test(text) &&
    !/\b(build|fix|run)\s+(?:the|this|my)\b/i.test(text)
  ) {
    return "scaffold_new";
  }

  if (
    /\b(fix|debug|patch|refactor|implement|add|update|change|extend|improve|wire|hook up|integrate)\b/i.test(
      text,
    )
  ) {
    return "extend";
  }

  if (turnProfile === "code") return "continue";

  return "explore";
}

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ADJECTIVE_FOLDER_NAMES = new Set(["simple", "basic", "mini", "small"]);

function findFolderNamedInMessage(message, inventory) {
  const text = String(message ?? "");
  for (const entry of inventory) {
    if (entry.isOrphan) continue;
    const name = entry.name;
    const asWord = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
    if (!asWord.test(text)) continue;

    if (ADJECTIVE_FOLDER_NAMES.has(name.toLowerCase())) {
      const asLocation = new RegExp(
        `\\b(?:in|at|under|inside|from|folder|directory|dir|project)\\s+${escapeRegex(name)}\\b|\\b${escapeRegex(name)}\\s+(?:folder|directory|project|app)\\b|/${escapeRegex(name)}(?:/|\\b)`,
        "i",
      );
      const asAdjective = new RegExp(
        `\\b(?:a|an|the|very|pretty|really)?\\s*${escapeRegex(name)}\\s+(?!folder|directory|project\\b)[a-z]`,
        "i",
      );
      if (asAdjective.test(text) && !asLocation.test(text)) continue;
    }

    return entry;
  }
  return null;
}

/** Longest matching project root for a workspace-relative path. */
export function projectRootFromPath(relativePath, inventory) {
  const p = sanitizeWorkspaceRelativePath(relativePath ?? ".");
  if (p === ".") return null;

  const projects = inventory.filter((e) => e.isProject && !e.isOrphan);
  let best = null;
  for (const proj of projects) {
    if (p === proj.path || p.startsWith(`${proj.path}/`)) {
      if (!best || proj.path.length > best.path.length) best = proj;
    }
  }
  if (best) return best.path;

  const top = p.split("/")[0];
  const entry = inventory.find((e) => e.name === top && !e.isOrphan);
  return entry?.path ?? top;
}

/**
 * Pull project folder hints from prior conversation turns (paths in tool output / file refs).
 * @returns {string[]}
 */
export function extractConversationProjectHints(conversation, inventory) {
  const hints = new Set();
  const projects = inventory.filter((e) => !e.isOrphan).map((e) => e.path);

  const addPath = (raw) => {
    const root = projectRootFromPath(raw, inventory);
    if (root && root !== ".") hints.add(root);
  };

  const persisted = sanitizeWorkspaceRelativePath(conversation?.cwd ?? ".");
  if (persisted !== ".") addPath(persisted);

  const messages = conversation?.llmMessages ?? [];
  const tail = messages.slice(-30);

  for (const msg of tail) {
    const content = String(msg.content ?? "");
    for (const proj of projects) {
      if (new RegExp(`\\b${escapeRegex(proj)}/`, "i").test(content)) {
        hints.add(proj);
      }
    }
    for (const match of content.matchAll(
      /(?:Wrote \d+ bytes to|=== FILE:|Inside project:|path["':\s]+)([a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)+)/gi,
    )) {
      addPath(match[1]);
    }
  }

  return [...hints];
}

function scoreStackMatch(message, entry) {
  const text = String(message ?? "").toLowerCase();
  let score = 0;
  for (const [stack, deps] of Object.entries(STACK_DEPS)) {
    if (!text.includes(stack)) continue;
    if (entry.stacks?.includes(stack)) score += 30;
    else if (entry.stacks?.some((s) => deps.some((d) => s.includes(d)))) score += 20;
  }
  return score;
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
  if (entry.name === slug || entry.name === `${slug}-app`) score += 8;
  if (entry.packageName && tokenize(entry.packageName).some((t) => descTokens.includes(t))) {
    score += 6;
  }

  return score;
}

function scoreMessageTokens(message, entry) {
  const tokens = tokenize(message);
  if (!tokens.length) return 0;

  let score = 0;
  const haystacks = [
    entry.name,
    entry.packageName ?? "",
    ...(entry.keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();

  for (const t of tokens) {
    if (haystacks.includes(t)) score += 4;
    if (entry.name.toLowerCase().includes(t)) score += 3;
  }
  return score;
}

/**
 * Cursor-style multi-project scoring.
 * @returns {Array<{ entry: import('./workspaceProjects.js').WorkspaceEntry, score: number, signals: string[] }>}
 */
export function rankProjectCandidates(context) {
  const {
    message = "",
    cwd = ".",
    explicitPath = null,
    conversationHints = [],
    mentionedProjects = [],
    intent = "continue",
  } = context;

  const inventory = context.inventory ?? [];
  const candidates = inventory.filter((e) => !e.isOrphan);
  const safeCwd = sanitizeWorkspaceRelativePath(cwd);
  const cwdProject = projectRootFromPath(safeCwd, inventory);
  const fresh = wantsFreshProject(message);
  const descriptor = extractAppDescriptor(message);
  const canonical = inferCanonicalDirName(message);
  const namedFolder = findFolderNamedInMessage(message, inventory);

  const ranked = [];

  for (const entry of candidates) {
    let score = 0;
    const signals = [];

    if (explicitPath) {
      const explicit = sanitizeWorkspaceRelativePath(explicitPath);
      if (entry.path === explicit || explicit.startsWith(`${entry.path}/`)) {
        score += 100;
        signals.push("explicit path in message");
      }
    }

    if (namedFolder?.path === entry.path) {
      score += 85;
      signals.push("folder name in message");
    }

    if (cwdProject === entry.path) {
      score += intent === "scaffold_new" && fresh ? 10 : 70;
      signals.push(
        intent === "scaffold_new" && fresh ? "cwd project (fresh override)" : "conversation/cwd location",
      );
    }

    for (const hint of conversationHints) {
      if (hint === entry.path) {
        score += 50;
        signals.push("prior turn activity");
      }
    }

    for (const mp of mentionedProjects) {
      if (mp === entry.path) {
        score += 35;
        signals.push("mentioned this session");
      }
    }

    const tokenScore = scoreMessageTokens(message, entry);
    if (tokenScore > 0) {
      score += tokenScore;
      signals.push("message keywords match project");
    }

    const stackScore = scoreStackMatch(message, entry);
    if (stackScore > 0) {
      score += stackScore;
      signals.push("stack match (vue/react/…)");
    }

    if (descriptor) {
      const nameScore = scoreNameMatch(descriptor, entry);
      if (nameScore > 0) {
        score += nameScore * (intent === "scaffold_new" ? 1.5 : 1);
        signals.push(`name match "${descriptor}"`);
      }
    }

    if (canonical && entry.name === canonical) {
      score += intent === "scaffold_new" ? 90 : 40;
      signals.push(`canonical alias "${canonical}"`);
    }

    const slug = descriptor ? slugifyProjectName(descriptor) : null;
    if (slug && entry.name === slug) {
      score += 95;
      signals.push("exact slug folder exists");
    }

    if (intent === "scaffold_new" && fresh && cwdProject === entry.path) {
      score -= 40;
      signals.push("fresh project requested — penalize cwd");
    }

    if (entry.isProject) {
      score += 5;
    }

    if (score > 0) {
      ranked.push({ entry, score, signals });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

/**
 * Unified project root decision (Cursor multi-root style).
 * @returns {Promise<{
 *   action: 'use_existing'|'create'|'workspace_view',
 *   dir: string|null,
 *   cwd: string,
 *   activeProject: string|null,
 *   confidence: 'high'|'medium'|'low',
 *   reason: string,
 *   intent: WorkspaceIntent,
 *   ranked: Array<{ path: string, score: number, signals: string[] }>,
 *   inventory: import('./workspaceProjects.js').WorkspaceEntry[],
 * }>}
 */
export async function resolveProjectContext({
  message = "",
  cwd = ".",
  explicitPath = null,
  turnProfile = "code",
  conversation = null,
  mentionedProjects = [],
} = {}) {
  const inventory = await scanWorkspaceProjects();
  const intent = classifyWorkspaceIntent(message, turnProfile);
  const safeCwd = sanitizeWorkspaceRelativePath(cwd);
  const fresh = wantsFreshProject(message);
  const conversationHints = extractConversationProjectHints(conversation, inventory);

  const ranked = rankProjectCandidates({
    message,
    cwd: safeCwd,
    explicitPath,
    conversationHints,
    mentionedProjects,
    intent,
    inventory,
  });

  const top = ranked[0] ?? null;
  const second = ranked[1] ?? null;
  const confidence =
    !top ? "low" : top.score >= 70 ? "high" : top.score >= 40 ? "medium" : "low";
  const ambiguous =
    top && second && top.score >= 35 && second.score >= 35 && top.score - second.score < 18;

  const rankedSummary = ranked.slice(0, 5).map((r) => ({
    path: r.entry.path,
    score: Math.round(r.score),
    signals: r.signals,
  }));

  /** @type {{ action: 'use_existing'|'create'|'workspace_view', dir: string|null, cwd: string, activeProject: string|null, confidence: string, reason: string, intent: WorkspaceIntent, ranked: typeof rankedSummary, inventory: typeof inventory }} */
  const result = {
    action: "workspace_view",
    dir: null,
    cwd: safeCwd,
    activeProject: null,
    confidence,
    reason: "",
    intent,
    ranked: rankedSummary,
    inventory,
  };

  if (intent === "explore" && safeCwd === "." && !top) {
    result.reason =
      "Multi-project workspace — exploring from root; call inspect_codebase on a specific folder before editing.";
    return result;
  }

  if (intent === "scaffold_new") {
    const descriptor = extractAppDescriptor(message);
    const slugHint = descriptor ? slugifyProjectName(descriptor) : null;

    if (explicitPath && !fresh) {
      const dir = sanitizeWorkspaceRelativePath(explicitPath);
      const exists = inventory.some((e) => e.path === dir);
      if (exists) {
        result.action = "use_existing";
        result.dir = dir;
        result.cwd = dir;
        result.activeProject = dir;
        result.reason = `Named folder "${dir}/" — using existing location.`;
        return result;
      }
      result.action = "workspace_view";
      result.reason =
        `Named folder "${dir}/" is not on disk yet — you choose when to create it ` +
        `(run_bash mkdir -p ${dir} or write_file under ${dir}/). ` +
        `Call inspect_codebase after creating to lock the project root.`;
      return result;
    }

    if (top && top.score >= 90 && !fresh) {
      result.action = "use_existing";
      result.dir = top.entry.path;
      result.cwd = top.entry.path;
      result.activeProject = top.entry.path;
      result.reason = `Scaffold reuses existing "${top.entry.path}/" (${top.signals.join(", ")}).`;
      if (ambiguous) {
        result.reason += ` Alternatives: ${rankedSummary.slice(1, 3).map((r) => r.path).join(", ")}.`;
      }
      return result;
    }

    if (slugHint) {
      const exact = inventory.find((e) => e.name === slugHint);
      if (exact && !fresh) {
        result.action = "use_existing";
        result.dir = slugHint;
        result.cwd = slugHint;
        result.activeProject = slugHint;
        result.reason = exact.isProject
          ? `Project "${slugHint}/" already exists — extending in place.`
          : `Folder "${slugHint}/" exists — scaffolds inside it.`;
        return result;
      }
    }

    const inventoryHint =
      rankedSummary.length > 0
        ? ` Existing folders: ${rankedSummary.map((r) => r.path).join(", ")}.`
        : "";
    const nameHint = slugHint
      ? ` Suggested name if you create new: "${slugHint}/" (agent decides — not created yet).`
      : "";
    result.action = "workspace_view";
    result.reason =
      `New scaffold — choose a project folder name yourself.${inventoryHint}${nameHint} ` +
      `Use run_bash mkdir -p <name> or write_file (parents auto-created), then inspect_codebase to lock the root.`;
    return result;
  }

  // extend | continue | explore-with-target
  if (top && top.score >= 35) {
    result.action = "use_existing";
    result.dir = top.entry.path;
    result.cwd = top.entry.path;
    result.activeProject = top.entry.path;
    result.reason = `Working in "${top.entry.path}/" (${top.signals.slice(0, 3).join(", ")}).`;
    if (ambiguous) {
      result.confidence = "medium";
      result.reason += ` Also relevant: ${second.entry.path}/ (score ${Math.round(second.score)}).`;
    }
    return result;
  }

  const cwdProject = projectRootFromPath(safeCwd, inventory);
  if (cwdProject && safeCwd !== ".") {
    result.action = "use_existing";
    result.dir = cwdProject;
    result.cwd = safeCwd;
    result.activeProject = cwdProject;
    result.reason = `Continuing in cwd "${safeCwd}" (project ${cwdProject}/).`;
    return result;
  }

  const projects = inventory.filter((e) => e.isProject && !e.isOrphan);
  if (projects.length === 1 && intent !== "explore") {
    result.action = "use_existing";
    result.dir = projects[0].path;
    result.cwd = projects[0].path;
    result.activeProject = projects[0].path;
    result.reason = `Single project workspace — defaulting to "${projects[0].path}/".`;
    return result;
  }

  if (intent === "explore") {
    result.reason =
      "Multi-project workspace — no strong target; inspect_codebase on a folder before edits.";
    return result;
  }

  result.reason =
    "Multi-project workspace — no confident match; inspect_codebase or name the project folder.";
  return result;
}
