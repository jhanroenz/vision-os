/**
 * Normalize bash commands when cwd is already inside the locked project root.
 * Prevents mkdir -p my-app/src from creating my-app/my-app/src when cwd is my-app.
 */

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePath(p) {
  return String(p ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/^\.\//, "");
}

/**
 * Strip redundant locked-root prefix from mkdir/cd/rm path segments.
 * @param {string} command
 * @param {string} lockedRoot
 * @param {string} [effectiveCwd]
 * @returns {{ command: string, rewritten: boolean, notes: string[] }}
 */
export function normalizeBashCommandForLockedRoot(command, lockedRoot, effectiveCwd) {
  const notes = [];
  if (!command || !lockedRoot || lockedRoot === ".") {
    return { command: String(command ?? ""), rewritten: false, notes };
  }

  const root = normalizePath(lockedRoot);
  const cwd = normalizePath(effectiveCwd ?? lockedRoot);
  const cwdInProject = cwd === root || cwd.startsWith(`${root}/`);
  if (!cwdInProject) {
    return { command: String(command), rewritten: false, notes };
  }

  const rootEsc = escapeRegExp(root);
  let cmd = String(command);
  let rewritten = false;

  const rewrite = (pattern, replacement, note) => {
    const next = cmd.replace(pattern, replacement);
    if (next !== cmd) {
      cmd = next;
      rewritten = true;
      notes.push(note);
    }
  };

  // mkdir -p failure-test/src → mkdir -p src (when cwd is failure-test)
  rewrite(
    new RegExp(`\\b(mkdir\\s+(?:-p\\s+)?)${rootEsc}/`, "g"),
    "$1",
    `stripped "${root}/" prefix from mkdir (cwd is ${cwd})`,
  );

  // mkdir -p failure-test → no-op marker when already inside project
  rewrite(
    new RegExp(`\\b(mkdir\\s+(?:-p\\s+)?)${rootEsc}(?=\\s|&&|;|$)`, "g"),
    "$1.",
    `mkdir target is locked root — use mkdir -p src or subpaths only`,
  );

  rewrite(
    new RegExp(`\\b(cd\\s+)${rootEsc}(?=\\s|&&|;|$)`, "g"),
    "$1.",
    `cd ${root} skipped — already in project root`,
  );

  rewrite(
    new RegExp(`\\b(rm\\s+(?:-rf?|--recursive\\s+)?)${rootEsc}/`, "g"),
    "$1",
    `stripped "${root}/" prefix from rm`,
  );

  return { command: cmd, rewritten, notes };
}

/** Detect mkdir that would nest lockedRoot inside itself. */
export function wouldCreateNestedProjectPath(command, lockedRoot, effectiveCwd) {
  if (!command || !lockedRoot || lockedRoot === ".") return null;

  const root = normalizePath(lockedRoot);
  const cwd = normalizePath(effectiveCwd ?? lockedRoot);
  if (cwd !== root && !cwd.startsWith(`${root}/`)) return null;

  for (const m of String(command).matchAll(
    /\bmkdir\s+(?:-p\s+)?["']?([a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*)/gi,
  )) {
    const target = normalizePath(m[1]);
    if (target === root || target.startsWith(`${root}/`)) {
      return target;
    }
  }
  return null;
}
