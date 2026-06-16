import fs from "node:fs/promises";
import path from "node:path";

export const EXT_STACK_HINTS = {
  ".ts": "Node/TypeScript",
  ".tsx": "Node/TypeScript (React)",
  ".js": "Node/JavaScript",
  ".jsx": "Node/JavaScript (React)",
  ".vue": "Node/Vue",
  ".svelte": "Node/Svelte",
  ".py": "Python",
  ".rs": "Rust",
  ".go": "Go",
  ".java": "Java",
  ".rb": "Ruby",
  ".php": "PHP",
};

export const SCAFFOLD_INIT_HINTS = {
  "Node/TypeScript": "npm init -y → write package.json + entry files → npm install",
  "Node/JavaScript": "npm init -y → write package.json + entry files → npm install",
  "Node/TypeScript (React)": "npm create vite@latest . -- --template react-ts",
  "Node/JavaScript (React)": "npm create vite@latest . -- --template react",
  "Node/Vue": "npm create vite@latest . -- --template vue  (NOT npm create vue@latest)",
  "Node/Svelte": "npm create vite@latest . -- --template svelte",
  Python: "uv init  OR  python -m venv .venv",
  Rust: "cargo init",
  Go: "go mod init <module>",
  Java: "gradle init --type basic --dsl kotlin",
  Ruby: "bundle init",
  PHP: "composer init --no-interaction",
};

/** Shallow scan for file extensions → stack labels (max 3). */
export async function inferStackFromFiles(dirPath) {
  const seen = new Set();
  try {
    const toScan = [{ dir: dirPath, depth: 0 }];
    while (toScan.length) {
      const { dir, depth } = toScan.shift();
      if (depth > 2) continue;
      let list;
      try {
        list = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of list) {
        if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
        if (ent.isDirectory() && depth < 2) {
          toScan.push({ dir: path.join(dir, ent.name), depth: depth + 1 });
        } else if (ent.isFile()) {
          const hint = EXT_STACK_HINTS[path.extname(ent.name).toLowerCase()];
          if (hint) seen.add(hint);
        }
        if (seen.size >= 3) break;
      }
      if (seen.size >= 3) break;
    }
  } catch {
    // ignore
  }
  return [...seen];
}

export function stackToProjectType(stackLabel) {
  if (!stackLabel) return "scaffold";
  if (stackLabel.startsWith("Node/")) return "node";
  if (stackLabel === "Python") return "python";
  if (stackLabel === "Rust") return "rust";
  if (stackLabel === "Go") return "go";
  if (stackLabel === "Java") return "java";
  if (stackLabel === "Ruby") return "ruby";
  if (stackLabel === "PHP") return "php";
  return "generic";
}
