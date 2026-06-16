<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import {
    WorkspaceFS,
    normalizeWorkspacePath,
    type WorkspaceEntry
  } from '$lib/api/workspace';
  import { openNotepad } from '$lib/apps/registry';
  import { desktop } from '$lib/stores/desktop';
  import { activeWindowId } from '$lib/stores/windows';
  import { dialogConfirm, dialogPrompt, isDialogOpen } from '$lib/stores/dialogs';
  import { FILE_SHORTCUT_HINTS, handleFileShortcuts } from '$lib/files/shortcuts';

  interface Props {
    windowId?: string;
    startPath?: string;
  }

  type ClipboardState = { path: string; mode: 'cut' | 'copy' };

  let { windowId, startPath = '.' }: Props = $props();

  let workspaceRoot = $state('');
  let currentPath = $state(normalizeWorkspacePath(startPath));
  let pathHistory = $state<string[]>([normalizeWorkspacePath(startPath)]);
  let selectedItem = $state<WorkspaceEntry | null>(null);
  let entries = $state<WorkspaceEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let status = $state<string | null>(null);
  let clipboard = $state<ClipboardState | null>(null);
  let contextMenu = $state<{ x: number; y: number; item: WorkspaceEntry } | null>(null);
  let listEl: HTMLDivElement | undefined = $state();
  let rootEl: HTMLDivElement | undefined = $state();

  const sidebarPaths = $derived.by(() => {
    const root = { path: '.', label: '🏠 Workspace root' };
    if (!workspaceRoot) return [root];
    const parts = workspaceRoot.split('/').filter(Boolean);
    const quick: { path: string; label: string }[] = [root];
    if (parts.length >= 2) {
      quick.push({
        path: parts.slice(-2).join('/'),
        label: `📂 ${parts.slice(-2).join('/')}`
      });
    }
    if (parts.length >= 1) {
      quick.push({
        path: parts[parts.length - 1],
        label: `📂 ${parts[parts.length - 1]}`
      });
    }
    return quick;
  });

  const breadcrumb = $derived(
    currentPath === '.' ? workspaceRoot || '.' : `${workspaceRoot}/${currentPath}`
  );

  const canPaste = $derived(Boolean(clipboard));
  const hasSelection = $derived(Boolean(selectedItem));

  function setStatus(message: string | null) {
    status = message;
  }

  function showError(err: unknown, fallback: string) {
    const message = err instanceof Error ? err.message : fallback;
    error = message;
    setStatus(message);
  }

  function clearError() {
    error = null;
  }

  function hideContextMenu() {
    contextMenu = null;
  }

  async function loadDirectory(path = currentPath) {
    loading = true;
    clearError();
    try {
      const listing = await WorkspaceFS.list(path);
      workspaceRoot = listing.workspace;
      currentPath = normalizeWorkspacePath(listing.path);
      entries = listing.entries;
    } catch (err) {
      showError(err, 'Could not load folder.');
      entries = [];
    } finally {
      loading = false;
    }
  }

  function isFilesWindowActive() {
    return !windowId || get(activeWindowId) === windowId;
  }

  function focusFilesApp() {
    rootEl?.focus({ preventScroll: true });
  }

  function onFilesKeyDown(event: KeyboardEvent) {
    if (!isFilesWindowActive()) return;

    if (isDialogOpen()) return;

    handleFileShortcuts(
      event,
      {
        copy: copySelected,
        cut: cutSelected,
        paste: () => void pasteClipboard(),
        delete: () => void deleteSelected(),
        rename: renameSelected,
        selectAll: selectAll,
        refresh: () => void loadDirectory(currentPath)
      },
      {
        canCopy: hasSelection,
        canCut: hasSelection,
        canPaste,
        canDelete: hasSelection
      }
    );
  }

  function selectAll() {
    if (entries.length === 0) return;
    selectedItem = entries[entries.length - 1];
    setStatus(`Selected ${entries.length} items (last item active)`);
  }

  onMount(() => {
    void loadDirectory(currentPath);

    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (!isFilesWindowActive()) return;
      onFilesKeyDown(event);
    };

    window.addEventListener('keydown', onWindowKeyDown, true);
    return () => window.removeEventListener('keydown', onWindowKeyDown, true);
  });

  function formatSize(bytes: number | null | undefined) {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function navigate(path: string) {
    const normalized = normalizeWorkspacePath(path);
    currentPath = normalized;
    pathHistory = [normalized];
    selectedItem = null;
    hideContextMenu();
    void loadDirectory(normalized);
  }

  function openItem(entry: WorkspaceEntry) {
    hideContextMenu();
    if (entry.type === 'dir') {
      currentPath = normalizeWorkspacePath(entry.path);
      pathHistory = [...pathHistory, currentPath];
      selectedItem = null;
      void loadDirectory(currentPath);
    } else {
      openNotepad(entry.path);
    }
  }

  function goBack() {
    if (pathHistory.length <= 1) return;
    const next = pathHistory.slice(0, -1);
    pathHistory = next;
    currentPath = next[next.length - 1];
    selectedItem = null;
    hideContextMenu();
    void loadDirectory(currentPath);
  }

  async function createFolder() {
    const name = await dialogPrompt({
      title: 'New folder',
      label: 'Folder name',
      confirmLabel: 'Create',
      placeholder: 'My folder'
    });
    if (!name) return;
    try {
      await WorkspaceFS.createFolder(currentPath, name);
      setStatus(`Created folder "${name}"`);
      await loadDirectory(currentPath);
    } catch (err) {
      showError(err, 'Could not create folder.');
    }
  }

  async function createFile() {
    const name = await dialogPrompt({
      title: 'New file',
      label: 'File name',
      defaultValue: 'notes.txt',
      confirmLabel: 'Create',
      placeholder: 'notes.txt'
    });
    if (!name) return;
    try {
      await WorkspaceFS.createFile(currentPath, name, '');
      setStatus(`Created file "${name}"`);
      await loadDirectory(currentPath);
    } catch (err) {
      showError(err, 'Could not create file.');
    }
  }

  function cutSelected() {
    if (!selectedItem) {
      setStatus('Select an item to cut.');
      return;
    }
    clipboard = { path: selectedItem.path, mode: 'cut' };
    setStatus(`Cut "${selectedItem.name}"`);
  }

  function copySelected() {
    if (!selectedItem) {
      setStatus('Select an item to copy.');
      return;
    }
    clipboard = { path: selectedItem.path, mode: 'copy' };
    setStatus(`Copied "${selectedItem.name}"`);
  }

  async function pasteClipboard() {
    if (!clipboard) {
      setStatus('Clipboard is empty.');
      return;
    }
    try {
      if (clipboard.mode === 'cut') {
        await WorkspaceFS.move(clipboard.path, currentPath);
        setStatus('Moved item.');
      } else {
        await WorkspaceFS.copy(clipboard.path, currentPath);
        setStatus('Pasted copy.');
      }
      if (selectedItem?.path === clipboard.path) {
        selectedItem = null;
      }
      clipboard = clipboard.mode === 'cut' ? null : clipboard;
      await loadDirectory(currentPath);
    } catch (err) {
      showError(err, 'Could not paste item.');
    }
  }

  async function deleteSelected() {
    if (!selectedItem) {
      setStatus('Select an item to delete.');
      return;
    }
    const item = selectedItem;
    const ok = await dialogConfirm({
      title: 'Delete item',
      message: `Delete "${item.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true
    });
    if (!ok) return;
    try {
      await WorkspaceFS.remove(item.path);
      if (clipboard?.path === item.path) clipboard = null;
      selectedItem = null;
      setStatus(`Deleted "${item.name}"`);
      await loadDirectory(currentPath);
    } catch (err) {
      showError(err, 'Could not delete item.');
    }
  }

  async function renameSelected() {
    if (!selectedItem) {
      setStatus('Select an item to rename.');
      return;
    }
    const item = selectedItem;
    const name = await dialogPrompt({
      title: 'Rename',
      label: 'New name',
      defaultValue: item.name,
      confirmLabel: 'Rename'
    });
    if (!name) return;
    try {
      const newPath = await WorkspaceFS.rename(item.path, name);
      if (clipboard?.path === item.path) {
        clipboard = { ...clipboard, path: newPath };
      }
      selectedItem = { ...item, name, path: newPath };
      setStatus(`Renamed to "${name}"`);
      await loadDirectory(currentPath);
    } catch (err) {
      showError(err, 'Could not rename item.');
    }
  }

  function pinToDesktop() {
    if (!selectedItem) {
      setStatus('Select an item to pin.');
      return;
    }
    desktop.addFileShortcut(selectedItem.path, selectedItem.name);
    setStatus(`Pinned "${selectedItem.name}" to desktop`);
  }

  function onItemContextMenu(event: MouseEvent, item: WorkspaceEntry) {
    event.preventDefault();
    event.stopPropagation();
    selectedItem = item;
    const rect = listEl?.getBoundingClientRect();
    const x = rect ? event.clientX - rect.left : event.clientX;
    const y = rect ? event.clientY - rect.top : event.clientY;
    contextMenu = { x, y, item };
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="files-app"
  bind:this={rootEl}
  tabindex="0"
  onclick={() => {
    hideContextMenu();
    focusFilesApp();
  }}
>
  <div class="files-sidebar">
    {#each sidebarPaths as { path, label } (path)}
      <button
        type="button"
        class:active={currentPath === normalizeWorkspacePath(path)}
        onclick={() => navigate(path)}
      >
        {label}
      </button>
    {/each}
  </div>

  <div class="files-main">
    <div class="files-toolbar">
      <button type="button" onclick={goBack} disabled={pathHistory.length <= 1}>← Back</button>
      <button type="button" onclick={createFolder}>+ Folder</button>
      <button type="button" onclick={createFile}>+ File</button>
      <span class="files-toolbar-sep"></span>
      <button type="button" onclick={cutSelected} disabled={!hasSelection} title={FILE_SHORTCUT_HINTS.cut}>✂ Cut</button>
      <button type="button" onclick={copySelected} disabled={!hasSelection} title={FILE_SHORTCUT_HINTS.copy}>⧉ Copy</button>
      <button type="button" onclick={() => void pasteClipboard()} disabled={!canPaste} title={FILE_SHORTCUT_HINTS.paste}>📋 Paste</button>
      <button type="button" onclick={renameSelected} disabled={!hasSelection} title={FILE_SHORTCUT_HINTS.rename}>✎ Rename</button>
      <button type="button" onclick={() => void deleteSelected()} disabled={!hasSelection} title={FILE_SHORTCUT_HINTS.delete}>🗑 Delete</button>
      <span class="files-toolbar-sep"></span>
      <button type="button" onclick={pinToDesktop} disabled={!hasSelection}>📌 Pin</button>
      <button type="button" onclick={() => loadDirectory(currentPath)} disabled={loading}>↻ Refresh</button>
      <span class="files-breadcrumb" title={breadcrumb}>{breadcrumb}</span>
    </div>

    {#if status}
      <div class="files-status">{status}</div>
    {/if}

    <div class="files-list" bind:this={listEl}>
      {#if loading}
        <div class="files-empty">Loading…</div>
      {:else if error}
        <div class="files-empty files-error">{error}</div>
      {:else if entries.length === 0}
        <div class="files-empty">This folder is empty — use + Folder or + File to create items.</div>
      {:else}
        {#each entries as item (item.path)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="files-item"
            class:selected={selectedItem?.path === item.path}
            class:clipboard-cut={clipboard?.mode === 'cut' && clipboard.path === item.path}
            onclick={() => (selectedItem = item)}
            ondblclick={() => openItem(item)}
            oncontextmenu={(event) => onItemContextMenu(event, item)}
          >
            <span class="item-icon">{item.type === 'dir' ? '📁' : '📄'}</span>
            <span class="item-name">{item.name}</span>
            <span class="item-size">{formatSize(item.size)}</span>
          </div>
        {/each}
      {/if}

      {#if contextMenu}
        <div
          class="files-context-menu"
          style="left: {contextMenu.x}px; top: {contextMenu.y}px"
          onclick={(event) => event.stopPropagation()}
        >
          <button type="button" onclick={() => openItem(contextMenu.item)}>Open</button>
          <button type="button" onclick={() => { selectedItem = contextMenu.item; cutSelected(); hideContextMenu(); }}>Cut</button>
          <button type="button" onclick={() => { selectedItem = contextMenu.item; copySelected(); hideContextMenu(); }}>Copy</button>
          <button type="button" disabled={!canPaste} onclick={() => { hideContextMenu(); void pasteClipboard(); }}>Paste</button>
          <hr />
          <button type="button" onclick={() => { selectedItem = contextMenu.item; hideContextMenu(); renameSelected(); }}>Rename</button>
          <button type="button" onclick={() => { selectedItem = contextMenu.item; hideContextMenu(); void deleteSelected(); }}>Delete</button>
          <button type="button" onclick={() => { selectedItem = contextMenu.item; hideContextMenu(); pinToDesktop(); }}>Pin to Desktop</button>
        </div>
      {/if}
    </div>

    <div class="files-shortcuts-hint">
      {FILE_SHORTCUT_HINTS.copy} Copy · {FILE_SHORTCUT_HINTS.cut} Cut · {FILE_SHORTCUT_HINTS.paste} Paste · {FILE_SHORTCUT_HINTS.delete} Delete · {FILE_SHORTCUT_HINTS.rename} Rename
    </div>
  </div>
</div>
