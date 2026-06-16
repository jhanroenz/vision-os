/**
 * Pure verification diagnostics — extracts file references from error output.
 * No stack-specific assumptions.
 */

const ERROR_FILE_PATTERNS = [
  /(?:^|\s)([\w./-]+\.(?:vue|ts|tsx|js|jsx|svelte|py|rs|go|java)):(\d+)(?::\d+)?/gm,
  /file:\s*\/[^\s]*\/([\w./-]+\.(?:vue|ts|tsx|js|jsx|svelte|py|rs|go))/g,
  /\bin\s+([\w./-]+\.(?:vue|ts|tsx|js|jsx|svelte|py|rs|go))\b/g,
  /Could not resolve entry module\s+"([^"]+)"/i,
  /Failed to resolve import\s+"([^"]+)"/i,
  /Cannot find module\s+'([^']+)'/i,
  /ENOENT[^\n]*'([^']+\.(?:vue|ts|js|html|json|py|rs|go))'/i,
];

/**
 * @returns {{ files: string[], summary: string }}
 */
export function extractVerificationErrors(content) {
  const text = String(content ?? "");
  const files = new Set();

  for (const pattern of ERROR_FILE_PATTERNS) {
    if (pattern.global) {
      for (const match of text.matchAll(pattern)) {
        const file = match[1]?.replace(/^\.\//, "");
        if (file && !file.includes("node_modules")) files.add(file);
      }
    } else if (pattern.test(text)) {
      const match = text.match(pattern);
      const file = match?.[1]?.replace(/^\.\//, "");
      if (file && !file.includes("node_modules")) files.add(file);
    }
  }

  const fileList = [...files].slice(0, 5);
  const summary = fileList.length
    ? `Errors cite: ${fileList.join(", ")}`
    : "";

  return { files: fileList, summary };
}

export function buildVerifyFailureGuidanceFromContent(content, projectRoot) {
  const { files, summary } = extractVerificationErrors(content);
  const root = projectRoot && projectRoot !== "." ? projectRoot : ".";

  const lines = [
    "Verification failed — read the error output and fix:",
    "1. read_file each file cited in the error (do NOT guess fixes).",
  ];

  if (files.length) {
    for (const f of files) {
      const full = f.startsWith(root)
        ? f
        : `${root}/${f}`.replace(/\/+/g, "/").replace(/^\.\//, "");
      lines.push(`   → read_file("${full}")`);
    }
  }

  lines.push(
    "2. Fix the cited file(s) with write_file or search_replace.",
    "3. run_bash the failing command directly to see full output if needed.",
    "4. verify_project again only after fixes are on disk.",
  );

  if (summary) lines.splice(1, 0, `Diagnosis: ${summary}`);

  return lines.join("\n");
}
