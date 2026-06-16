import { createTwoFilesPatch, structuredPatch } from "diff";

const MAX_DIFF_CHARS = 100 * 1024;

function countStats(hunks) {
  let additions = 0;
  let deletions = 0;

  for (const hunk of hunks ?? []) {
    for (const line of hunk.lines ?? []) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }
  }

  return { additions, deletions };
}

export function buildFileDiff(filePath, before = "", after = "") {
  const oldStr = before ?? "";
  const newStr = after ?? "";

  const unified = createTwoFilesPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    oldStr,
    newStr,
    "",
    "",
    { context: 3 },
  );

  const patch = structuredPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    oldStr,
    newStr,
    "",
    "",
    { context: 3 },
  );

  const stats = countStats(patch.hunks);
  const truncated = unified.length > MAX_DIFF_CHARS;

  return {
    stats,
    unified: truncated ? unified.slice(0, MAX_DIFF_CHARS) : unified,
    hunks: patch.hunks,
    truncated,
  };
}

export function buildFileChangePayload(filePath, before, after, action) {
  const diff = buildFileDiff(filePath, before, after);

  return {
    path: filePath,
    action,
    stats: diff.stats,
    diff: diff.hunks,
    unified: diff.unified,
    before: diff.truncated ? null : before,
    after: diff.truncated ? null : after,
    truncated: diff.truncated,
  };
}
