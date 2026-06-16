<script lang="ts">
  import { contextMenu, hideContextMenu, selectedDesktopKey } from '$lib/stores/os';
  import { nextWallpaper, randomWallpaper } from '$lib/stores/settings';
  import { desktop } from '$lib/stores/desktop';
  import { openApp } from '$lib/apps/registry';
  import { dialogAlert, dialogConfirm, dialogPrompt } from '$lib/stores/dialogs';

  function action(fn: () => void | Promise<void>) {
    void Promise.resolve(fn()).finally(() => hideContextMenu());
  }

  async function createFolder() {
    const name = await dialogPrompt({
      title: 'New folder',
      label: 'Folder name',
      confirmLabel: 'Create',
      placeholder: 'My folder'
    });
    if (!name) return;
    if (!desktop.createFolder(name)) {
      await dialogAlert({
        title: 'Could not create folder',
        message: 'A folder with that name may already exist here.'
      });
    }
  }

  async function renameSelected() {
    const key = $selectedDesktopKey;
    if (!key?.startsWith('folder:')) return;
    const folderId = key.slice('folder:'.length);
    const name = await dialogPrompt({
      title: 'Rename folder',
      label: 'New name',
      confirmLabel: 'Rename'
    });
    if (!name) return;
    desktop.renameFolder(folderId, name);
  }

  async function deleteSelected() {
    const key = $selectedDesktopKey;
    if (!key) return;
    const ok = await dialogConfirm({
      title: 'Remove from desktop',
      message: 'Remove this item from the desktop?',
      confirmLabel: 'Remove',
      destructive: true
    });
    if (!ok) return;
    desktop.deleteItem(key);
  }
</script>

{#if $contextMenu.open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="context-menu"
    style="left: {$contextMenu.x}px; top: {$contextMenu.y}px"
    onclick={(e) => e.stopPropagation()}
  >
    <button onclick={() => action(createFolder)}>📁 New Folder</button>
    {#if $selectedDesktopKey?.startsWith('folder:')}
      <button onclick={() => action(renameSelected)}>✎ Rename Folder</button>
    {/if}
    {#if $selectedDesktopKey}
      <button onclick={() => action(deleteSelected)}>🗑 Remove from Desktop</button>
    {/if}
    <hr />
    <button onclick={() => action(() => location.reload())}>↻ Refresh Desktop</button>
    <button onclick={() => action(() => openApp('settings'))}>⚙ Display Settings</button>
    <hr />
    <button onclick={() => action(nextWallpaper)}>🖼 Next Wallpaper</button>
    <button onclick={() => action(randomWallpaper)}>🎲 Random Wallpaper</button>
    <button onclick={() => action(() => openApp('about'))}>◎ About VisionOS</button>
  </div>
{/if}
