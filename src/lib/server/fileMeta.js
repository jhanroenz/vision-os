import path from "node:path";

const EXT_LANGUAGE = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".vue": "vue",
  ".json": "json",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
  ".htm": "html",
  ".md": "markdown",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".sh": "bash",
  ".bash": "bash",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".sql": "sql",
  ".php": "php",
  ".rb": "ruby",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
};

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".wasm",
  ".exe",
  ".dll",
  ".so",
  ".bin",
]);

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
]);

export function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_LANGUAGE[ext] ?? "plaintext";
}

export function isBinaryPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

export function isImagePath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export function isTextPath(filePath) {
  return !isBinaryPath(filePath);
}
