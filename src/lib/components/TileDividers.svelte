<script lang="ts">
  import { windows, tileDividers } from '$lib/stores/windows';
  import type { TileDivider, TileDividerOrientation } from '$lib/stores/tileLayout';

  let dragging = $state<{ orientation: TileDividerOrientation; index: number } | null>(null);
  let pointerBound = false;

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

  function onDividerMouseDown(
    orientation: TileDividerOrientation,
    index: number,
    e: MouseEvent
  ) {
    dragging = { orientation, index };
    bindPointerListeners();
    e.preventDefault();
  }

  function onMouseMove(e: MouseEvent) {
    if (!dragging) return;
    windows.resizeTileDivider(dragging.orientation, dragging.index, e.clientX, e.clientY);
  }

  function onMouseUp() {
    dragging = null;
    unbindPointerListeners();
  }

  function isDragging(orientation: TileDividerOrientation, index: number) {
    return dragging?.orientation === orientation && dragging?.index === index;
  }

  function dividerStyle(divider: TileDivider) {
    if (divider.orientation === 'vertical') {
      return `left:${divider.position}px;top:0;width:6px;height:calc(100vh - var(--taskbar-height))`;
    }
    return `left:0;top:${divider.position}px;width:100vw;height:6px`;
  }
</script>

{#each $tileDividers as divider (divider.id)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="tile-divider"
    class:tile-divider-vertical={divider.orientation === 'vertical'}
    class:tile-divider-horizontal={divider.orientation === 'horizontal'}
    class:dragging={isDragging(divider.orientation, divider.index)}
    style={dividerStyle(divider)}
    onmousedown={(e) => onDividerMouseDown(divider.orientation, divider.index, e)}
  ></div>
{/each}
