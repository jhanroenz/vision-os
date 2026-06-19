import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publishedAppDir } from "./paths.js";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const SDK_SCRIPT_TAG =
  '<script src="/visionos-sdk.js" defer></script>';

const HTML_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; object-src 'none'";

let sdkClientSource = null;

async function loadSdkClient() {
  if (sdkClientSource != null) return sdkClientSource;
  const sdkPath = fileURLToPath(
    new URL("../../../../static/visionos-sdk.js", import.meta.url),
  );
  try {
    sdkClientSource = await fs.readFile(sdkPath, "utf-8");
  } catch {
    sdkClientSource = "";
  }
  return sdkClientSource;
}

/** Resolve a safe path under appRoot; rejects traversal and symlinks escaping root. */
export async function resolveSafeAppPath(appRoot, requestPath) {
  const raw = String(requestPath ?? "").replace(/^\/+/, "");
  const normalized = path.normalize(raw);

  if (normalized.includes("..") || path.isAbsolute(normalized)) {
    throw new Error("Path traversal denied");
  }

  const fullPath = path.resolve(appRoot, normalized || "index.html");
  const rel = path.relative(appRoot, fullPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path outside app root");
  }

  let stat;
  try {
    stat = await fs.lstat(fullPath);
  } catch {
    throw new Error("File not found");
  }

  if (stat.isSymbolicLink()) {
    const target = await fs.realpath(fullPath);
    const targetRel = path.relative(appRoot, target);
    if (targetRel.startsWith("..") || path.isAbsolute(targetRel)) {
      throw new Error("Symlink escapes app root");
    }
    stat = await fs.stat(target);
    return { fullPath: target, stat, rel: targetRel || path.basename(target) };
  }

  if (stat.isDirectory()) {
    const indexPath = path.join(fullPath, "index.html");
    const indexStat = await fs.stat(indexPath);
    return {
      fullPath: indexPath,
      stat: indexStat,
      rel: path.join(normalized || "", "index.html"),
    };
  }

  return { fullPath, stat, rel: normalized || path.basename(fullPath) };
}

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function injectSdkIntoHtml(html, slug) {
  const meta = `<meta name="visionos-app-id" content="${slug}">`;
  let out = html;
  if (!out.includes('name="visionos-app-id"')) {
    out = out.replace(/<head[^>]*>/i, (match) => `${match}\n${meta}`);
  }
  if (!out.includes("visionos-sdk.js")) {
    out = out.replace(/<\/head>/i, `${SDK_SCRIPT_TAG}\n</head>`);
  }
  return out;
}

export async function serveAppAsset(slug, requestPath) {
  const appRoot = publishedAppDir(slug);
  const { fullPath, stat, rel } = await resolveSafeAppPath(appRoot, requestPath);

  const type = contentTypeFor(fullPath);
  const headers = {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache",
  };

  if (type.startsWith("text/html")) {
    headers["Content-Security-Policy"] = HTML_CSP;
    let html = await fs.readFile(fullPath, "utf-8");
    html = injectSdkIntoHtml(html, slug);
    return new Response(html, { status: 200, headers });
  }

  const body = await fs.readFile(fullPath);
  return new Response(body, {
    status: 200,
    headers: {
      ...headers,
      "Content-Length": String(stat.size),
    },
  });
}

export async function getSdkClientScript() {
  return loadSdkClient();
}
