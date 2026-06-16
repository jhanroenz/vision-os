import { derived, get, writable } from 'svelte/store';
import { loadJson, saveJson } from '$lib/persist';
import { APPS } from '$lib/apps/registry';

export type DesktopAppItem = { type: 'app'; appId: string };
export type DesktopFileItem = { type: 'file'; path: string; name: string };
export type DesktopFolderItem = {
  type: 'folder';
  id: string;
  name: string;
  children: DesktopItem[];
};
export type DesktopItem = DesktopAppItem | DesktopFileItem | DesktopFolderItem;

interface DesktopState {
  items: DesktopItem[];
  folderStack: string[];
}

function defaultItems(): DesktopItem[] {
  return APPS.filter((a) => a.id !== 'welcome').map((a) => ({
    type: 'app' as const,
    appId: a.id
  }));
}

function normalizeState(raw: unknown): DesktopState {
  if (!raw) return { items: defaultItems(), folderStack: [] };
  if (Array.isArray(raw)) return { items: raw as DesktopItem[], folderStack: [] };
  const state = raw as DesktopState;
  return {
    items: state.items?.length ? state.items : defaultItems(),
    folderStack: state.folderStack ?? []
  };
}

const internal = writable<DesktopState>(normalizeState(loadJson('desktop', null)));

function persist() {
  saveJson('desktop', get(internal));
}

export function itemKey(item: DesktopItem): string {
  if (item.type === 'app') return `app:${item.appId}`;
  if (item.type === 'file') return `file:${item.path}`;
  return `folder:${item.id}`;
}

export function findFolderById(items: DesktopItem[], id: string): DesktopFolderItem | null {
  for (const item of items) {
    if (item.type !== 'folder') continue;
    if (item.id === id) return item;
    const nested = findFolderById(item.children, id);
    if (nested) return nested;
  }
  return null;
}

function containsFolderId(items: DesktopItem[], id: string): boolean {
  for (const item of items) {
    if (item.type === 'folder') {
      if (item.id === id) return true;
      if (containsFolderId(item.children, id)) return true;
    }
  }
  return false;
}

function isInvalidFolderMove(items: DesktopItem[], srcFolderId: string, targetFolderStack: string[]): boolean {
  const targetId = targetFolderStack[targetFolderStack.length - 1];
  if (!targetId) return false;
  if (targetId === srcFolderId) return true;
  const srcFolder = findFolderById(items, srcFolderId);
  if (!srcFolder) return false;
  return containsFolderId(srcFolder.children, targetId);
}

function mapAtPath(
  items: DesktopItem[],
  folderStack: string[],
  updater: (children: DesktopItem[]) => DesktopItem[]
): DesktopItem[] {
  if (folderStack.length === 0) return updater(items);
  const [id, ...rest] = folderStack;
  return items.map((item) => {
    if (item.type !== 'folder' || item.id !== id) return item;
    return { ...item, children: mapAtPath(item.children, rest, updater) };
  });
}

function removeFromTree(items: DesktopItem[], key: string): { items: DesktopItem[]; removed: DesktopItem | null } {
  const index = items.findIndex((item) => itemKey(item) === key);
  if (index >= 0) {
    return {
      items: [...items.slice(0, index), ...items.slice(index + 1)],
      removed: items[index]
    };
  }

  let removed: DesktopItem | null = null;
  const next = items.map((item) => {
    if (item.type !== 'folder') return item;
    const result = removeFromTree(item.children, key);
    if (result.removed) removed = result.removed;
    return result.removed ? { ...item, children: result.items } : item;
  });

  return { items: next, removed };
}

function newFolderId() {
  return `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const folderStack = derived(internal, ($s) => $s.folderStack);

export const currentDesktopItems = derived(internal, ($s) => {
  if ($s.folderStack.length === 0) return $s.items;
  const folder = findFolderById($s.items, $s.folderStack[$s.folderStack.length - 1]);
  return folder?.children ?? [];
});

export const currentFolderName = derived(internal, ($s) => {
  if ($s.folderStack.length === 0) return null;
  const folder = findFolderById($s.items, $s.folderStack[$s.folderStack.length - 1]);
  return folder?.name ?? null;
});

export const desktop = {
  subscribe: internal.subscribe,

  createFolder(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return false;

    internal.update((state) => {
      const folder: DesktopFolderItem = {
        type: 'folder',
        id: newFolderId(),
        name: trimmed,
        children: []
      };
      return {
        ...state,
        items: mapAtPath(state.items, state.folderStack, (children) => {
          if (children.some((c) => c.type === 'folder' && c.name === trimmed)) return children;
          return [...children, folder];
        })
      };
    });
    persist();
    return true;
  },

  renameFolder(folderId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return false;

    internal.update((state) => ({
      ...state,
      items: mapFolder(state.items, folderId, (folder) => ({ ...folder, name: trimmed }))
    }));
    persist();
    return true;
  },

  addFileShortcut(path: string, name: string) {
    const key = `file:${path}`;
    internal.update((state) => {
      if (findItemByKey(state.items, key)) return state;
      const shortcut: DesktopFileItem = { type: 'file', path, name };
      return {
        ...state,
        items: mapAtPath(state.items, state.folderStack, (children) => [...children, shortcut])
      };
    });
    persist();
  },

  openFolder(folderId: string) {
    internal.update((state) => ({
      ...state,
      folderStack: [...state.folderStack, folderId]
    }));
    persist();
  },

  goUp() {
    internal.update((state) => ({
      ...state,
      folderStack: state.folderStack.slice(0, -1)
    }));
    persist();
  },

  goToRoot() {
    internal.update((state) => ({ ...state, folderStack: [] }));
    persist();
  },

  moveItem(itemKey: string, targetFolderStack: string[]) {
    const state = get(internal);
    if (itemKey.startsWith('folder:')) {
      const folderId = itemKey.slice('folder:'.length);
      if (isInvalidFolderMove(state.items, folderId, targetFolderStack)) return false;
    }

    const { items, removed } = removeFromTree(state.items, itemKey);
    if (!removed) return false;

    const nextItems = mapAtPath(items, targetFolderStack, (children) => {
      if (children.some((c) => itemKey(c) === itemKey)) return children;
      return [...children, removed];
    });

    internal.set({ items: nextItems, folderStack: state.folderStack });
    persist();
    return true;
  },

  deleteItem(itemKey: string) {
    internal.update((state) => {
      const { items } = removeFromTree(state.items, itemKey);
      return { ...state, items };
    });
    persist();
  },

  resetLayout() {
    internal.set({ items: defaultItems(), folderStack: [] });
    persist();
  }
};

function mapFolder(
  items: DesktopItem[],
  folderId: string,
  fn: (folder: DesktopFolderItem) => DesktopFolderItem
): DesktopItem[] {
  return items.map((item) => {
    if (item.type !== 'folder') return item;
    if (item.id === folderId) return fn(item);
    return { ...item, children: mapFolder(item.children, folderId, fn) };
  });
}

function findItemByKey(items: DesktopItem[], key: string): DesktopItem | null {
  for (const item of items) {
    if (itemKey(item) === key) return item;
    if (item.type === 'folder') {
      const nested = findItemByKey(item.children, key);
      if (nested) return nested;
    }
  }
  return null;
}
