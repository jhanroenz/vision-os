<script lang="ts">
  import Wallpaper from './Wallpaper.svelte';
  import DesktopItemIcon from './DesktopItemIcon.svelte';
  import Window from './Window.svelte';
  import { currentDesktopItems, currentFolderName, desktop, folderStack } from '$lib/stores/desktop';
  import { visibleWindows } from '$lib/stores/windows';
  import {
    clearSelectedDesktopKey,
    contextMenu,
    hideContextMenu,
    hideStartMenu,
    showContextMenu
  } from '$lib/stores/os';
  import { get } from 'svelte/store';

  let dragOverDesktop = $state(false);

  function onDesktopClick() {
    clearSelectedDesktopKey();
    hideStartMenu();
    hideContextMenu();
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  }

  function onDesktopDragOver(e: DragEvent) {
    e.preventDefault();
    dragOverDesktop = true;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  function onDesktopDragLeave() {
    dragOverDesktop = false;
  }

  function onDesktopDrop(e: DragEvent) {
    e.preventDefault();
    dragOverDesktop = false;
    const dragged = e.dataTransfer?.getData('text/plain');
    if (!dragged) return;
    desktop.moveItem(dragged, get(folderStack));
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div
  class="desktop"
  class:desktop-drop={dragOverDesktop}
  onclick={onDesktopClick}
  oncontextmenu={onContextMenu}
  ondragover={onDesktopDragOver}
  ondragleave={onDesktopDragLeave}
  ondrop={onDesktopDrop}
>
  <Wallpaper />

  {#if $folderStack.length > 0}
    <div class="desktop-breadcrumb">
      <button type="button" onclick={(e) => { e.stopPropagation(); desktop.goToRoot(); }}>Desktop</button>
      {#if $currentFolderName}
        <span>/</span>
        <span>{$currentFolderName}</span>
      {/if}
      <button type="button" class="desktop-back" onclick={(e) => { e.stopPropagation(); desktop.goUp(); }}>↑ Up</button>
    </div>
  {/if}

  <div class="desktop-icons">
    {#each $currentDesktopItems as item (item.type === 'folder' ? item.id : item.type === 'app' ? item.appId : item.path)}
      <DesktopItemIcon {item} />
    {/each}
  </div>

  {#each $visibleWindows as win (win.id)}
    <Window {win} />
  {/each}
</div>
