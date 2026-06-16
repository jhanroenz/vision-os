import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafePath } from "./workspace.js";
import { detectLanguage, isBinaryPath, isImagePath, isTextPath } from "./fileMeta.js";

export async function readWorkspaceFile(relativePath) {
  const safePath = relativePath;
  const fullPath = resolveSafePath(safePath);
  const stat = await fs.stat(fullPath);

  if (!stat.isFile()) {
    throw new Error(`"${safePath}" is not a file`);
  }

  const language = detectLanguage(safePath);
  const binary = isBinaryPath(safePath);

  if (binary && !isImagePath(safePath)) {
    return {
      path: safePath,
      size: stat.size,
      language,
      binary: true,
      content: null,
    };
  }

  if (isImagePath(safePath)) {
    const data = await fs.readFile(fullPath);
    const ext = path.extname(safePath).slice(1).toLowerCase();
    const mime =
      ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
    return {
      path: safePath,
      size: stat.size,
      language,
      binary: false,
      image: true,
      content: `data:${mime};base64,${data.toString("base64")}`,
    };
  }

  if (!isTextPath(safePath)) {
    return {
      path: safePath,
      size: stat.size,
      language,
      binary: true,
      content: null,
    };
  }

  const content = await fs.readFile(fullPath, "utf-8");
  return {
    path: safePath,
    size: stat.size,
    language,
    binary: false,
    image: false,
    content,
    lineCount: content.split("\n").length,
  };
}

export function buildFileOpenPreview(content, maxLines = 80) {
  if (!content) return { preview: "", lineCount: 0 };
  const lines = content.split("\n");
  const preview = lines.slice(0, maxLines).join("\n");
  return { preview, lineCount: lines.length };
}
