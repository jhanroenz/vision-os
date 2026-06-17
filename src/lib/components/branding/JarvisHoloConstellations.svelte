<script lang="ts">
  import { onMount } from 'svelte';
  import { initHoloConstellations } from '$lib/boot/holo-constellations';

  interface Props {
    speed?: number;
  }

  let { speed = 1 }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();

  onMount(() => {
    if (!canvas) return;
    const handle = initHoloConstellations(canvas, { speed });
    return () => handle.destroy();
  });
</script>

<canvas
  class="jarvis-holo-constellations"
  bind:this={canvas}
  aria-hidden="true"
></canvas>
