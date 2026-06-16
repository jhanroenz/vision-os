<script lang="ts">
  import { onMount } from 'svelte';
  import { currentWallpaper, settings } from '$lib/stores/settings';
  import { createCanvasLoop } from '$lib/wallpapers/engine';
  import JarvisBootBrand from '$lib/components/branding/JarvisBootBrand.svelte';
  import JarvisHoloConstellations from '$lib/components/branding/JarvisHoloConstellations.svelte';

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let reducedMotion = $state(false);

  onMount(() => {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  $effect(() => {
    const wp = $currentWallpaper;
    if (wp.type !== 'canvas' || !wp.renderer || !canvasEl) return;

    const cleanup = createCanvasLoop(
      canvasEl,
      wp.renderer,
      $settings.wallpaperSpeed,
      reducedMotion
    );
    return cleanup;
  });
</script>

<div class="wallpaper-stack">
  {#if $currentWallpaper.type === 'gradient'}
    <div
      class="wallpaper-css"
      style="background: {$currentWallpaper.css}"
      aria-hidden="true"
    ></div>
  {:else if $currentWallpaper.type === 'css'}
    <div
      class="wallpaper-css {$currentWallpaper.cssClass}"
      style="--wp-speed: {$settings.wallpaperSpeed}"
      aria-hidden="true"
    ></div>
  {:else if $currentWallpaper.type === 'scene' && $currentWallpaper.scene === 'jarvis-boot'}
    <div
      class="wallpaper-scene wp-jarvis-boot"
      style="--wp-speed: {$settings.wallpaperSpeed}"
      aria-hidden="true"
    >
      <div class="boot-glow"></div>
      <JarvisHoloConstellations speed={$settings.wallpaperSpeed} />
      <div class="boot-content wallpaper-brand-content">
        <JarvisBootBrand logo3d speed={$settings.wallpaperSpeed} />
      </div>
    </div>
  {:else}
    <canvas bind:this={canvasEl} class="wallpaper-canvas" aria-hidden="true"></canvas>
  {/if}
  <div class="wallpaper-dim" style="opacity: {$settings.wallpaperDim}"></div>
  <div class="wallpaper-grid" aria-hidden="true"></div>
</div>
