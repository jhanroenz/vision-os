/**
 * Detect and block interactive scaffold/install commands.
 * Agents must use non-interactive flags or manual file scaffolding instead.
 */

const INTERACTIVE_RULES = [
  {
    id: "npm-create-vue",
    pattern: /\bnpm\s+create\s+vue@latest\b/i,
    isInteractive: (cmd) => !/--\s+(-[a-zA-Z]|--)/.test(cmd),
    reason: "npm create vue@latest opens an interactive wizard (TypeScript, Router, Pinia prompts).",
    alternatives: [
      'Non-interactive Vite+Vue: npm create vite@latest <dir> -- --template vue',
      'Or manual scaffold: mkdir -p <dir> && npm init -y (cwd=<dir>), then write_file package.json, vite.config.js, index.html, src/main.js, src/App.vue, then npm install',
    ],
  },
  {
    id: "create-vue",
    pattern: /\bcreate-vue\b/i,
    isInteractive: (cmd) => !/--defaults?\b/.test(cmd) && !/--\s+(-[a-zA-Z]|--)/.test(cmd),
    reason: "create-vue is interactive unless all options are passed via CLI flags.",
    alternatives: [
      'Use: npm create vite@latest <dir> -- --template vue',
      'Or scaffold package.json + entry files with write_file, then npm install',
    ],
  },
  {
    id: "npm-create-svelte",
    pattern: /\bnpm\s+create\s+svelte@latest\b/i,
    isInteractive: (cmd) => !/--\s+--template\b/.test(cmd) && !/--\s+(-[a-zA-Z]|--)/.test(cmd),
    reason: "npm create svelte@latest prompts for options interactively.",
    alternatives: [
      'Use: npm create vite@latest <dir> -- --template svelte',
      'Or manual scaffold with write_file then npm install',
    ],
  },
  {
    id: "npm-init",
    pattern: /\bnpm\s+init\b(?!\s+-y\b)/i,
    isInteractive: () => true,
    reason: "npm init without -y prompts for package metadata interactively.",
    alternatives: ['Use: npm init -y'],
  },
  {
    id: "vue-cli",
    pattern: /\bvue\s+create\b/i,
    isInteractive: () => true,
    reason: "vue create is an interactive wizard.",
    alternatives: [
      'Use: npm create vite@latest <dir> -- --template vue',
      'Or manual scaffold with write_file',
    ],
  },
  {
    id: "create-react-app",
    pattern: /\bcreate-react-app\b/i,
    isInteractive: (cmd) => !/--template\b/.test(cmd),
    reason: "create-react-app can prompt interactively without a template flag.",
    alternatives: [
      'Use: npm create vite@latest <dir> -- --template react',
      'Or: npx create-react-app <dir> --template typescript (still prefer Vite for new projects)',
    ],
  },
  {
    id: "rails-new",
    pattern: /\brails\s+new\b/i,
    isInteractive: (cmd) => !/--skip\b/.test(cmd) && !/-[a-z]/i.test(cmd),
    reason: "rails new may prompt without skip/database flags.",
    alternatives: [
      'Use: rails new <dir> --skip-bundle --database=sqlite3',
      'Or manual scaffold: Gemfile + config files via write_file',
    ],
  },
  {
    id: "django-startproject",
    pattern: /\bdjango-admin\s+startproject\b/i,
    isInteractive: () => false, // non-interactive by default
    reason: null,
    alternatives: [],
  },
  {
    id: "gradle-init",
    pattern: /\bgradle\s+init\b/i,
    isInteractive: (cmd) => !/--type\b/.test(cmd),
    reason: "gradle init prompts for project type without --type.",
    alternatives: ['Use: gradle init --type basic --dsl kotlin'],
  },
  {
    id: "cargo-new-interactive",
    pattern: /\bcargo\s+new\b/i,
    isInteractive: () => false,
    reason: null,
    alternatives: [],
  },
  {
    id: "composer-create",
    pattern: /\bcomposer\s+create-project\b/i,
    isInteractive: (cmd) => !/--no-interaction\b/.test(cmd) && !/-n\b/.test(cmd),
    reason: "composer create-project may prompt without --no-interaction.",
    alternatives: ['Add: --no-interaction (or -n)'],
  },
  {
    id: "pip-interactive",
    pattern: /\bpip\s+install\b/i,
    isInteractive: (cmd) => /\s-i\s*$|\s--editable\s*$/.test(cmd),
    reason: null,
    alternatives: [],
  },
];

/**
 * @returns {{ blocked: boolean, ruleId?: string, reason?: string, alternatives?: string[] }}
 */
export function analyzeBashCommand(command) {
  const cmd = String(command ?? "").trim();
  if (!cmd) {
    return {
      blocked: true,
      ruleId: "missing-command",
      reason: "run_bash requires a non-empty command string.",
      alternatives: [
        'Example: {"tool":"run_bash","args":{"command":"mkdir -p my-app && cd my-app && npm init -y","cwd":"."}}',
      ],
    };
  }

  for (const rule of INTERACTIVE_RULES) {
    if (!rule.pattern.test(cmd)) continue;
    if (rule.isInteractive && !rule.isInteractive(cmd)) continue;
    if (!rule.reason) continue;

    return {
      blocked: true,
      ruleId: rule.id,
      reason: rule.reason,
      alternatives: rule.alternatives,
    };
  }

  return { blocked: false };
}

export function formatInteractiveBlockMessage(analysis) {
  const lines = [
    "BLOCKED: Interactive command not allowed in agent mode.",
    analysis.reason,
    "",
    "Non-interactive alternatives:",
    ...analysis.alternatives.map((a) => `  • ${a}`),
    "",
    "General rule: never use scaffold wizards that prompt for input.",
    "Prefer (1) non-interactive CLI with all flags, or (2) write_file for package.json + entrypoints, then npm/pip/cargo install.",
  ];
  return lines.join("\n");
}

/** Env vars that force non-interactive behavior across common tools. */
export const NON_INTERACTIVE_ENV = {
  CI: "true",
  DEBIAN_FRONTEND: "noninteractive",
  npm_config_yes: "true",
  NPX_YES: "1",
  CREATE_VITE_SKIP_PROMPT: "1",
};

export const SCAFFOLD_GUIDANCE_BLOCK = `Non-interactive scaffolding (mandatory):
- NEVER run commands that open wizards or wait for keyboard input (npm create vue@latest, vue create, interactive npm init, etc.).
- For new projects: mkdir the folder → npm init -y / cargo init / go mod init / uv init → write_file package.json + entry files → npm install / pip install.
- Node/Vue (preferred): npm create vite@latest <dir> -- --template vue  (fully non-interactive)
- Node/React: npm create vite@latest <dir> -- --template react
- Python: uv init <dir>  OR  mkdir <dir> && write pyproject.toml
- Rust: cargo init <dir>
- Go: mkdir <dir> && go mod init <module>
- All run_bash commands run with CI=true — interactive prompts will fail or hang.`;
