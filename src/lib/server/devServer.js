const DEV_COMMAND_PATTERNS = [
  /\bnpm\s+run\s+dev\b/i,
  /\bnpm\s+start\b/i,
  /\bnpx\s+vite\b(?!\s+build\b)/i,
  /\bvite\s*$/i,
  /\bnext\s+dev\b/i,
  /\bng\s+serve\b/i,
  /\bpython\s+-m\s+http\.server\b/i,
  /\bpnpm\s+(run\s+)?dev\b/i,
  /\byarn\s+(run\s+)?dev\b/i,
];

export function isDevServerCommand(command) {
  const cmd = String(command ?? "");
  if (/\bnpm\s+create\b/i.test(cmd)) return false;
  if (/\bnpx\s+create-/i.test(cmd)) return false;
  if (/\bcreate\s+vue@/i.test(cmd)) return false;
  return DEV_COMMAND_PATTERNS.some((p) => p.test(cmd));
}

export function formatDevServerBlockMessage(command) {
  const hasInstall = /\bnpm\s+install\b|\bpnpm\s+install\b|\byarn\s+install\b/i.test(
    command,
  );
  const lines = [
    "RESULT: FAILED (exit 1)",
    "Long-running dev servers are not executed in the agent shell.",
  ];
  if (hasInstall) {
    lines.push(
      "This command chains install with a dev server — split them:",
      "  1. run_bash: npm install (or pnpm/yarn install) only",
      "  2. run_check or verify_project for build/lint/test",
    );
  } else {
    lines.push(
      "Run npm install separately if dependencies are missing.",
    );
  }
  lines.push(
    "Verify with run_check (e.g. npm run build) or verify_project.",
    "Master Jan can run npm run dev locally for a live preview.",
  );
  return lines.join("\n");
}
