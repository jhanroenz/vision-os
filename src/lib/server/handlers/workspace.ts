import {
  listWorkspace,
  getWorkspaceSnapshot,
  ensureThreadWorkspace,
  sanitizeWorkspaceRelativePath
} from '../workspace.js';
import { readWorkspaceFile } from '../files.js';
import { getFileChange } from '../changeLog.js';
import {
  getWorkspaceRootInfo,
  mkdirWorkspace,
  writeWorkspaceFile,
  removeWorkspaceEntry,
  moveWorkspaceEntry,
  renameWorkspaceEntry,
  copyWorkspaceEntry,
  statWorkspaceEntry
} from '../workspaceFs.js';
import { json, jsonError, readJson } from '../http.js';

const FILES_THREAD = 'visionos-files';

export async function list(url: URL) {
  const threadId = url.searchParams.get('threadId') ?? FILES_THREAD;

  try {
    await ensureThreadWorkspace(threadId);
    const viewPath = sanitizeWorkspaceRelativePath(
      url.searchParams.get('path') ?? '.'
    );

    const listing = await listWorkspace(viewPath);
    return json({
      ...listing,
      ...getWorkspaceSnapshot(threadId, listing.path)
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export function root() {
  return json(getWorkspaceRootInfo());
}

export async function file(url: URL) {
  const threadId = url.searchParams.get('threadId') ?? FILES_THREAD;
  const filePath = url.searchParams.get('path');

  if (!filePath) {
    return jsonError('path is required', 400);
  }

  try {
    await ensureThreadWorkspace(threadId);
    const safePath = sanitizeWorkspaceRelativePath(filePath);
    const fileData = await readWorkspaceFile(safePath);
    return json(fileData);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function putFile(request: Request) {
  try {
    const { path: filePath, content } = await readJson<{ path?: string; content?: string }>(request);
    if (!filePath) return jsonError('path is required', 400);
    const saved = await writeWorkspaceFile(filePath, content ?? '');
    return json({ ok: true, path: saved });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function postMkdir(request: Request) {
  try {
    const { parent, name } = await readJson<{ parent?: string; name?: string }>(request);
    if (!name) return jsonError('name is required', 400);
    const created = await mkdirWorkspace(parent ?? '.', name);
    return json({ ok: true, path: created });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function deleteEntry(url: URL) {
  const entryPath = url.searchParams.get('path');
  if (!entryPath) return jsonError('path is required', 400);

  try {
    const removed = await removeWorkspaceEntry(entryPath);
    return json({ ok: true, path: removed });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function postMove(request: Request) {
  try {
    const { from, to } = await readJson<{ from?: string; to?: string }>(request);
    if (!from || !to) return jsonError('from and to are required', 400);
    const moved = await moveWorkspaceEntry(from, to);
    return json({ ok: true, path: moved });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function postRename(request: Request) {
  try {
    const { path: entryPath, name } = await readJson<{ path?: string; name?: string }>(request);
    if (!entryPath || !name) return jsonError('path and name are required', 400);
    const renamed = await renameWorkspaceEntry(entryPath, name);
    return json({ ok: true, path: renamed });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function postCopy(request: Request) {
  try {
    const { from, to } = await readJson<{ from?: string; to?: string }>(request);
    if (!from || !to) return jsonError('from and to are required', 400);
    const copied = await copyWorkspaceEntry(from, to);
    return json({ ok: true, path: copied });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function stat(url: URL) {
  const entryPath = url.searchParams.get('path');
  if (!entryPath) return jsonError('path is required', 400);

  try {
    const info = await statWorkspaceEntry(entryPath);
    return json(info);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function diff(changeId: string, url: URL) {
  const threadId = url.searchParams.get('threadId') ?? FILES_THREAD;

  try {
    const change = getFileChange(threadId, changeId);
    if (!change) {
      return jsonError('Change not found', 404);
    }
    return json(change);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}
