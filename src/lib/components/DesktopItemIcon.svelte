<script lang="ts">
  import { get } from 'svelte/store';
  import type { DesktopItem } from '$lib/stores/desktop';
  import { desktop, folderStack, itemKey } from '$lib/stores/desktop';
  import { selectedDesktopKey, setSelectedDesktopKey } from '$lib/stores/os';
  import { getAppById, openApp, openFiles, openNotepad } from '$lib/apps/registry';
  import { WorkspaceFS } from '$lib/api/workspace';

  interface Props {
    item: DesktopItem;
  }

  let { item }: Props = $props();

  const key = $derived(itemKey(item));

  const label = $derived.by(() => {
    if (item.type === 'app') return getAppById(item.appId)?.name ?? item.appId;
    return item.name;
  });

  const emoji = $derived.by(() => {
    if (item.type === 'app') return getAppById(item.appId)?.icon ?? '📦';
    if (item.type === 'file' && item.name.includes('.')) return '📄';
    if (item.type === 'file') return '📁';
    return '📁';
  });

  let dragOver = $state(false);

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    setSelectedDesktopKey(key);
  }

  async function handleDblClick() {
    if (item.type === 'app') {
      openApp(item.appId);
      return;
    }
    if (item.type === 'file') {
      try {
        const exists = await WorkspaceFS.exists(item.path);
        if (!exists) return;
        if (await WorkspaceFS.isFolder(item.path)) openFiles(item.path);
        else openNotepad(item.path);
      } catch {
        // ignore
      }
      return;
    }
    desktop.openFolder(item.id);
  }

  function onDragStart(e: DragEvent) {
    e.stopPropagation();
    e.dataTransfer?.setData('text/plain', key);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e: DragEvent) {
    if (item.type !== 'folder') return;
    e.preventDefault();
    e.stopPropagation();
    dragOver = true;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  function onDragLeave() {
    dragOver = false;
  }

  function onDrop(e: DragEvent) {
    if (item.type !== 'folder') return;
    e.preventDefault();
    e.stopPropagation();
    dragOver = false;
    const dragged = e.dataTransfer?.getData('text/plain');
    if (!dragged || dragged === key) return;
    desktop.moveItem(dragged, [...get(folderStack), item.id]);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="desktop-icon"
  class:selected={$selectedDesktopKey === key}
  class:folder-drop={dragOver}
  draggable="true"
  ondragstart={onDragStart}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  ondblclick={handleDblClick}
  onclick={handleClick}
>
  <div class="icon-glow"></div>
  <div class="icon-emoji">{emoji}</div>
  <span>{label}</span>
</div>
