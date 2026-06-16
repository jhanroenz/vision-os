<script lang="ts">
  import { get as storeGet } from 'svelte/store';
  import type { WindowState } from '$lib/types';
  import { windows } from '$lib/stores/windows';
  import { previewSnapRect, TASKBAR_HEIGHT, type SnapZone } from '$lib/stores/tileLayout';
  import { getAppById } from '$lib/apps/registry';

  interface Props {
    win: WindowState;
  }

  type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

  let { win }: Props = $props();

  const app = $derived(getAppById(win.appId));
  const AppComponent = $derived(app?.component);

  const MIN_W = 280;
  const MIN_H = 180;
  const SNAP_EDGE_PX = 24;
  const DRAG_THRESHOLD = 4;

  let dragging = $state(false);
  let resizing = $state(false);
  let maximizedDragPending = $state(false);
  let maximizedDragStart = { x: 0, y: 0 };
  let dragStart = { x: 0, y: 0, winX: 0, winY: 0 };
  let resizeStart = {
    x: 0,
    y: 0,
    winX: 0,
    winY: 0,
    w: 0,
    h: 0,
    edge: 'se' as ResizeEdge
  };
  let snapTarget = $state<null | SnapZone>(null);
  let snapPreview = $state<null | { x: number; y: number; width: number; height: number }>(null);
  let pointerBound = false;

  function resolveSnapTarget(x: number, y: number): null | SnapZone {
    const desktopHeight = window.innerHeight - TASKBAR_HEIGHT;
    if (y <= SNAP_EDGE_PX) return 'top';
    if (x <= SNAP_EDGE_PX) return 'left';
    if (x >= window.innerWidth - SNAP_EDGE_PX) return 'right';
    return null;
  }

  function bindPointerListeners() {
    if (pointerBound) return;
    pointerBound = true;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function unbindPointerListeners() {
    if (!pointerBound) return;
    pointerBound = false;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  function onTitleMouseDown(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.window-controls')) return;
    windows.focus(win.id);

    if (win.maximized) {
      maximizedDragPending = true;
      maximizedDragStart = { x: e.clientX, y: e.clientY };
      bindPointerListeners();
      e.preventDefault();
      return;
    }

    if (win.tiled) windows.untile(win.id);
    dragging = true;
    snapTarget = null;
    snapPreview = null;
    dragStart = { x: e.clientX, y: e.clientY, winX: win.x, winY: win.y };
    bindPointerListeners();
    e.preventDefault();
  }

  function onTitleDoubleClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.window-controls')) return;
    dragging = false;
    maximizedDragPending = false;
    snapTarget = null;
    snapPreview = null;
    unbindPointerListeners();
    windows.toggleMaximize(win.id);
    e.preventDefault();
  }

  function onResizeMouseDown(edge: ResizeEdge, e: MouseEvent) {
    if (win.maximized || win.tiled) return;
    resizing = true;
    resizeStart = {
      x: e.clientX,
      y: e.clientY,
      winX: win.x,
      winY: win.y,
      w: win.width,
      h: win.height,
      edge
    };
    bindPointerListeners();
    e.preventDefault();
    e.stopPropagation();
  }

  function computeResize(clientX: number, clientY: number) {
    const dx = clientX - resizeStart.x;
    const dy = clientY - resizeStart.y;
    const edge = resizeStart.edge;

    let x = resizeStart.winX;
    let y = resizeStart.winY;
    let width = resizeStart.w;
    let height = resizeStart.h;

    if (edge.includes('e')) width = resizeStart.w + dx;
    if (edge.includes('w')) {
      width = resizeStart.w - dx;
      x = resizeStart.winX + dx;
    }
    if (edge.includes('s')) height = resizeStart.h + dy;
    if (edge.includes('n')) {
      height = resizeStart.h - dy;
      y = resizeStart.winY + dy;
    }

    if (width < MIN_W) {
      if (edge.includes('w')) x += width - MIN_W;
      width = MIN_W;
    }
    if (height < MIN_H) {
      if (edge.includes('n')) y += height - MIN_H;
      height = MIN_H;
    }

    const maxX = Math.max(0, window.innerWidth - width);
    const maxY = Math.max(0, window.innerHeight - TASKBAR_HEIGHT - height);
    x = Math.min(Math.max(0, x), maxX);
    y = Math.min(Math.max(0, y), maxY);

    return { x, y, width, height };
  }

  function onMouseMove(e: MouseEvent) {
    if (maximizedDragPending) {
      const dx = e.clientX - maximizedDragStart.x;
      const dy = e.clientY - maximizedDragStart.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      const restored = windows.restoreFromMaximizeDrag(win.id, e.clientX, e.clientY);
      maximizedDragPending = false;
      dragging = true;
      snapTarget = null;
      snapPreview = null;
      dragStart = { x: e.clientX, y: e.clientY, winX: restored.x, winY: restored.y };
    }
    if (dragging) {
      const target = resolveSnapTarget(e.clientX, e.clientY);
      snapTarget = target;
      if (target) {
        snapPreview = previewSnapRect(target, storeGet(windows), win.id);
      } else {
        snapPreview = null;
      }
      windows.move(
        win.id,
        dragStart.winX + e.clientX - dragStart.x,
        dragStart.winY + e.clientY - dragStart.y
      );
    }
    if (resizing) {
      const bounds = computeResize(e.clientX, e.clientY);
      windows.resize(win.id, bounds.width, bounds.height, { x: bounds.x, y: bounds.y });
    }
  }

  function onMouseUp() {
    if (dragging && snapTarget) {
      windows.snap(win.id, snapTarget);
    }
    dragging = false;
    resizing = false;
    maximizedDragPending = false;
    snapTarget = null;
    snapPreview = null;
    unbindPointerListeners();
  }

  function onWindowMouseDown() {
    windows.focus(win.id);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="window"
  class:maximized={win.maximized}
  class:tiled={win.tiled}
  style="left:{win.x}px; top:{win.y}px; width:{win.width}px; height:{win.height}px; z-index:{win.zIndex}"
  onmousedown={onWindowMouseDown}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="window-titlebar" onmousedown={onTitleMouseDown} ondblclick={onTitleDoubleClick}>
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
  {#if !win.maximized && !win.tiled}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="window-resize-edge window-resize-n" onmousedown={(e) => onResizeMouseDown('n', e)}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="window-resize-edge window-resize-s" onmousedown={(e) => onResizeMouseDown('s', e)}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="window-resize-edge window-resize-e" onmousedown={(e) => onResizeMouseDown('e', e)}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="window-resize-edge window-resize-w" onmousedown={(e) => onResizeMouseDown('w', e)}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="window-resize-edge window-resize-ne" onmousedown={(e) => onResizeMouseDown('ne', e)}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="window-resize-edge window-resize-nw" onmousedown={(e) => onResizeMouseDown('nw', e)}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="window-resize-edge window-resize-se" onmousedown={(e) => onResizeMouseDown('se', e)}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="window-resize-edge window-resize-sw" onmousedown={(e) => onResizeMouseDown('sw', e)}></div>
  {/if}
</div>

{#if dragging && snapPreview}
  <div
    class="window-snap-preview"
    style="left:{snapPreview.x}px;top:{snapPreview.y}px;width:{snapPreview.width}px;height:{snapPreview.height}px"
  ></div>
{/if}
