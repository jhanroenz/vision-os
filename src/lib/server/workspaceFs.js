import fs from 'node:fs/promises';
import path from 'node:path';
import { sanitizeWorkspaceRelativePath, resolveSafePath } from './workspace.js';
import { config } from './config.js';

const ENTRY_NAME_RE = /^[^/\\<>:"|?*\x00-\x1f]+$/;

function assertEntryName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed || !ENTRY_NAME_RE.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw new Error('Invalid entry name');
  }
  return trimmed;
}

function joinRelative(parentPath, name) {
  const parent = sanitizeWorkspaceRelativePath(parentPath);
  if (parent === '.') return name;
  return `${parent}/${name}`;
}

export function getWorkspaceRootInfo() {
  return {
    workspace: path.resolve(config.workspaceDir),
    path: '.'
  };
}

export async function mkdirWorkspace(parentPath, name) {
  const entryName = assertEntryName(name);
  const parent = sanitizeWorkspaceRelativePath(parentPath);
  const fullParent = resolveSafePath(parent);
  const target = path.join(fullParent, entryName);

  if (target === path.resolve(config.workspaceDir)) {
    throw new Error('Folder already exists');
  }

  await fs.mkdir(target, { recursive: false });
  return joinRelative(parent, entryName);
}

export async function writeWorkspaceFile(relativePath, content) {
  const safePath = sanitizeWorkspaceRelativePath(relativePath);
  const fullPath = resolveSafePath(safePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content ?? '', 'utf-8');
  return safePath;
}

export async function removeWorkspaceEntry(relativePath) {
  const safePath = sanitizeWorkspaceRelativePath(relativePath);
  if (safePath === '.') throw new Error('Cannot remove workspace root');
  const fullPath = resolveSafePath(safePath);
  const stat = await fs.stat(fullPath);
  if (stat.isDirectory()) {
    await fs.rm(fullPath, { recursive: true, force: true });
  } else {
    await fs.unlink(fullPath);
  }
  return safePath;
}

function assertInsideWorkspace(fullPath) {
  const workspace = path.resolve(config.workspaceDir);
  if (!fullPath.startsWith(workspace + path.sep) && fullPath !== workspace) {
    throw new Error('Path is outside workspace');
  }
}

async function assertDestinationAvailable(destFull) {
  try {
    await fs.access(destFull);
    throw new Error('Destination already exists');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function copyEntryRecursive(srcFull, destFull) {
  const stat = await fs.stat(srcFull);
  if (stat.isDirectory()) {
    await fs.mkdir(destFull, { recursive: true });
    const entries = await fs.readdir(srcFull, { withFileTypes: true });
    for (const entry of entries) {
      await copyEntryRecursive(
        path.join(srcFull, entry.name),
        path.join(destFull, entry.name)
      );
    }
    return;
  }
  await fs.copyFile(srcFull, destFull);
}

export async function moveWorkspaceEntry(srcRelative, destParentRelative) {
  const src = sanitizeWorkspaceRelativePath(srcRelative);
  if (src === '.') throw new Error('Cannot move workspace root');

  const destParent = sanitizeWorkspaceRelativePath(destParentRelative);
  const srcFull = resolveSafePath(src);
  const destParentFull = resolveSafePath(destParent);
  const entryName = path.basename(srcFull);
  const destFull = path.join(destParentFull, entryName);

  assertInsideWorkspace(destFull);
  if (destFull === srcFull || destFull.startsWith(srcFull + path.sep)) {
    throw new Error('Invalid move destination');
  }

  await assertDestinationAvailable(destFull);

  await fs.mkdir(destParentFull, { recursive: true });
  await fs.rename(srcFull, destFull);
  return joinRelative(destParent, entryName);
}

export async function renameWorkspaceEntry(relativePath, newName) {
  const src = sanitizeWorkspaceRelativePath(relativePath);
  if (src === '.') throw new Error('Cannot rename workspace root');

  const entryName = assertEntryName(newName);
  const srcFull = resolveSafePath(src);
  const parentFull = path.dirname(srcFull);
  const destFull = path.join(parentFull, entryName);

  assertInsideWorkspace(destFull);
  if (destFull === srcFull) {
    return src;
  }

  await assertDestinationAvailable(destFull);
  await fs.rename(srcFull, destFull);

  const parentRel = path.relative(config.workspaceDir, parentFull).replace(/\\/g, '/');
  const parent = !parentRel || parentRel === '.' ? '.' : parentRel;
  return joinRelative(parent, entryName);
}

export async function copyWorkspaceEntry(srcRelative, destParentRelative) {
  const src = sanitizeWorkspaceRelativePath(srcRelative);
  if (src === '.') throw new Error('Cannot copy workspace root');

  const destParent = sanitizeWorkspaceRelativePath(destParentRelative);
  const srcFull = resolveSafePath(src);
  const destParentFull = resolveSafePath(destParent);
  const entryName = path.basename(srcFull);
  const destFull = path.join(destParentFull, entryName);

  assertInsideWorkspace(destFull);
  if (destFull === srcFull || destFull.startsWith(srcFull + path.sep)) {
    throw new Error('Invalid copy destination');
  }

  await assertDestinationAvailable(destFull);
  await copyEntryRecursive(srcFull, destFull);
  return joinRelative(destParent, entryName);
}

export async function statWorkspaceEntry(relativePath) {
  const safePath = sanitizeWorkspaceRelativePath(relativePath);
  const fullPath = resolveSafePath(safePath);
  const stat = await fs.stat(fullPath);
  return {
    path: safePath,
    type: stat.isDirectory() ? 'dir' : 'file',
    size: stat.isFile() ? stat.size : null,
    modified: stat.mtimeMs
  };
}
