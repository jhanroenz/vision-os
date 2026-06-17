<script lang="ts">
  import { onMount } from 'svelte';
  import { initLogo3dCanvas } from '$lib/boot/logo3d-canvas';
  import '$lib/styles/visionos-logo.css';

  interface Props {
    size?: number;
    speed?: number;
  }

  let { size = 88, speed = 1 }: Props = $props();

  const canvasPad = 1.58;
  const canvasSize = $derived(Math.round(size * canvasPad));

  let canvas: HTMLCanvasElement | undefined = $state();

  onMount(() => {
    if (!canvas) return;
    const handle = initLogo3dCanvas(canvas, { size, speed });
    return () => handle.destroy();
  });
</script>

<div class="visionos-logo-3d-wrap" style:width="{canvasSize}px" style:height="{canvasSize}px">
  <canvas
    class="visionos-logo-3d"
    bind:this={canvas}
    width={canvasSize}
    height={canvasSize}
    style:width="{canvasSize}px"
    style:height="{canvasSize}px"
    role="img"
    aria-label="VisionOS"
  ></canvas>
</div>
