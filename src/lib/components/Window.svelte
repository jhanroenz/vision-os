<script lang="ts">
  import { onMount } from 'svelte';
  import type { WindowState } from '$lib/types';
  import { windows } from '$lib/stores/windows';
  import { getAppById } from '$lib/apps/registry';

  interface Props {
    win: WindowState;
  }

  let { win }: Props = $props();

  const app = $derived(getAppById(win.appId));
  const AppComponent = $derived(app?.component);

  let dragging = $state(false);
  let resizing = $state(false);
  let dragStart = { x: 0, y: 0, winX: 0, winY: 0 };
  let resizeStart = { x: 0, y: 0, w: 0, h: 0 };

  function onTitleMouseDown(e: MouseEvent) {
    if (win.maximized) return;
    if ((e.target as HTMLElement).closest('.window-controls')) return;
    dragging = true;
    dragStart = { x: e.clientX, y: e.clientY, winX: win.x, winY: win.y };
    windows.focus(win.id);
    e.preventDefault();
  }

  function onResizeMouseDown(e: MouseEvent) {
    if (win.maximized) return;
    resizing = true;
    resizeStart = { x: e.clientX, y: e.clientY, w: win.width, h: win.height };
    e.preventDefault();
    e.stopPropagation();
  }

  function onMouseMove(e: MouseEvent) {
    if (dragging) {
      windows.move(
        win.id,
        dragStart.winX + e.clientX - dragStart.x,
        dragStart.winY + e.clientY - dragStart.y
      );
    }
    if (resizing) {
      windows.resize(
        win.id,
        resizeStart.w + e.clientX - resizeStart.x,
        resizeStart.h + e.clientY - resizeStart.y
      );
    }
  }

  function onMouseUp() {
    dragging = false;
    resizing = false;
  }

  onMount(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="window"
  class:maximized={win.maximized}
  style="left:{win.x}px; top:{win.y}px; width:{win.width}px; height:{win.height}px; z-index:{win.zIndex}"
  onmousedown={() => windows.focus(win.id)}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="window-titlebar" onmousedown={onTitleMouseDown}>
    <span class="window-app-icon">{app?.icon ?? '◻'}</span>
    <span class="window-title">{win.title}</span>
    <div class="window-controls">
      <button class="window-btn minimize" title="Minimize" onclick={() => windows.minimize(win.id)}>─</button>
      <button class="window-btn maximize" title="Maximize" onclick={() => windows.toggleMaximize(win.id)}>□</button>
      <button class="window-btn close" title="Close" onclick={() => windows.close(win.id)}>✕</button>
    </div>
  </div>
  <div class="window-content">
    {#if AppComponent}
      <AppComponent windowId={win.id} {...(win.props ?? {})} />
    {/if}
  </div>
  {#if !win.maximized}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="window-resize-handle" onmousedown={onResizeMouseDown}></div>
  {/if}
</div>
