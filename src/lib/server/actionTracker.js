const threadActions = new Map();

export function recordAction(threadId, action) {
  if (!threadActions.has(threadId)) {
    threadActions.set(threadId, []);
  }
  threadActions.get(threadId).push({
    ...action,
    at: Date.now(),
  });
}

export function getActions(threadId) {
  return threadActions.get(threadId) ?? [];
}

export function clearActions(threadId) {
  threadActions.delete(threadId);
}

export function getWrittenFiles(threadId) {
  return getActions(threadId)
    .filter((a) => a.tool === "write_file" || a.tool === "search_replace")
    .map((a) => a.path);
}

export function getBashCommands(threadId) {
  return getActions(threadId).filter((a) => a.tool === "run_bash");
}

export function formatActionSummary(threadId) {
  const actions = getActions(threadId);
  if (!actions.length) return null;

  const written = [...new Set(getWrittenFiles(threadId))];
  const commands = getBashCommands(threadId);

  const lines = [];
  if (written.length) {
    lines.push(`Files written this turn: ${written.join(", ")}`);
  }
  if (commands.length) {
    const cmdLines = commands.map((c) => {
      const exit = c.exitCode != null ? ` (exit ${c.exitCode})` : "";
      return `  ${c.command}${exit}`;
    });
    lines.push(`Commands run:\n${cmdLines.join("\n")}`);
  }
  return lines.length ? lines.join("\n") : null;
}
