<script lang="ts">
  import JarvisBootBrand from '$lib/components/branding/JarvisBootBrand.svelte';
  import JarvisHoloConstellations from '$lib/components/branding/JarvisHoloConstellations.svelte';

  interface Props {
    progress?: number;
    status?: string;
    detail?: string;
    fading?: boolean;
  }

  let {
    progress = 0,
    status = 'Starting VisionOS…',
    detail = '',
    fading = false
  }: Props = $props();
</script>

<div class="boot" class:fade-out={fading}>
  <div class="boot-glow"></div>
  <JarvisHoloConstellations />
  <div class="boot-content">
    <JarvisBootBrand logo3d />
    <div
      class="boot-progress"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(progress)}
    >
      <div class="boot-progress-bar" style="width: {progress}%"></div>
    </div>
    <p class="boot-status">{status}</p>
    {#if detail}
      <p class="boot-detail">{detail}</p>
    {:else}
      <p class="boot-detail" aria-hidden="true">&nbsp;</p>
    {/if}
  </div>
</div>
