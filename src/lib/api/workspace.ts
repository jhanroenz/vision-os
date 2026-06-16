/** Client for Jarvis workspace filesystem (real files under WORKSPACE_DIR). */

export interface WorkspaceEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
}

export interface WorkspaceListing {
  workspace: string;
  path: string;
  entries: WorkspaceEntry[];
  cwd?: string;
}

export interface WorkspaceFileData {
  path: string;
  size: number;
  language?: string;
  binary: boolean;
  image?: boolean;
  content: string | null;
  lineCount?: number;
}

export interface WorkspaceStat {
  path: string;
  type: 'dir' | 'file';
  size: number | null;
  modified: number;
}

const FILES_THREAD = 'visionos-files';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: string }).error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

function qs(params: Record<string, string>) {
  return new URLSearchParams(params).toString();
}

export function normalizeWorkspacePath(input = '.'): string {
  let p = String(input).trim().replace(/\\/g, '/');
  if (!p || p === '/') return '.';
  p = p.replace(/^\/+/, '');
  if (p === '') return '.';
  const parts = p.split('/').filter(Boolean);
  if (parts.some((part) => part === '..')) return '.';
  return parts.join('/');
}

export function joinWorkspacePath(parent: string, name: string): string {
  const base = normalizeWorkspacePath(parent);
  const cleanName = name.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleanName || cleanName.includes('/')) {
    throw new Error('Invalid entry name');
  }
  return base === '.' ? cleanName : `${base}/${cleanName}`;
}

export const WorkspaceFS = {
  async getRoot(): Promise<{ workspace: string; path: string }> {
    return api('/api/workspace/root');
  },

  async list(path = '.'): Promise<WorkspaceListing> {
    const normalized = normalizeWorkspacePath(path);
    return api(`/api/workspace?${qs({ threadId: FILES_THREAD, path: normalized })}`);
  },

  async read(path: string): Promise<WorkspaceFileData> {
    const normalized = normalizeWorkspacePath(path);
    return api(`/api/workspace/file?${qs({ threadId: FILES_THREAD, path: normalized })}`);
  },

  async readText(path: string): Promise<string | null> {
    const file = await WorkspaceFS.read(path);
    if (file.binary && !file.image) return null;
    return file.content ?? '';
  },

  async write(path: string, content: string): Promise<void> {
    const normalized = normalizeWorkspacePath(path);
    await api('/api/workspace/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: normalized, content })
    });
  },

  async createFolder(parentPath: string, name: string): Promise<void> {
    await api('/api/workspace/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parent: normalizeWorkspacePath(parentPath),
        name
      })
    });
  },

  async createFile(parentPath: string, name: string, content = ''): Promise<void> {
    const filePath = joinWorkspacePath(parentPath, name);
    await WorkspaceFS.write(filePath, content);
  },

  async remove(path: string): Promise<void> {
    await api(`/api/workspace/entry?${qs({ path: normalizeWorkspacePath(path) })}`, {
      method: 'DELETE'
    });
  },

  async move(from: string, toParent: string): Promise<string> {
    const result = await api<{ path: string }>('/api/workspace/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: normalizeWorkspacePath(from),
        to: normalizeWorkspacePath(toParent)
      })
    });
    return result.path;
  },

  async rename(path: string, name: string): Promise<string> {
    const result = await api<{ path: string }>('/api/workspace/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: normalizeWorkspacePath(path),
        name
      })
    });
    return result.path;
  },

  async copy(from: string, toParent: string): Promise<string> {
    const result = await api<{ path: string }>('/api/workspace/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: normalizeWorkspacePath(from),
        to: normalizeWorkspacePath(toParent)
      })
    });
    return result.path;
  },

  async stat(path: string): Promise<WorkspaceStat> {
    return api(`/api/workspace/stat?${qs({ path: normalizeWorkspacePath(path) })}`);
  },

  async exists(path: string): Promise<boolean> {
    try {
      await WorkspaceFS.stat(path);
      return true;
    } catch {
      return false;
    }
  },

  async isFolder(path: string): Promise<boolean> {
    try {
      const info = await WorkspaceFS.stat(path);
      return info.type === 'dir';
    } catch {
      return false;
    }
  }
};

/** @deprecated use WorkspaceFS */
export const FileSystem = WorkspaceFS;
