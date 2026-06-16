<script lang="ts">
  import { onMount } from 'svelte';
  import { booted } from '$lib/stores/os';
  import JarvisBootBrand from '$lib/components/branding/JarvisBootBrand.svelte';
  import JarvisHoloConstellations from '$lib/components/branding/JarvisHoloConstellations.svelte';

  const statuses = [
    'Initializing neural core...',
    'Loading vision kernel...',
    'Mounting workspace...',
    'Starting window compositor...',
    'Syncing persistence layer...',
    'Loading interface modules...',
    'Welcome to VisionOS'
  ];

  let progress = $state(0);
  let status = $state(statuses[0]);
  let fading = $state(false);

  onMount(() => {
    const start = performance.now();
    const duration = 2800;

    const tick = () => {
      const elapsed = performance.now() - start;
      progress = Math.min(100, (elapsed / duration) * 100);
      const idx = Math.min(
        statuses.length - 1,
        Math.floor((elapsed / duration) * statuses.length)
      );
      status = statuses[idx];

      if (elapsed < duration) {
        requestAnimationFrame(tick);
      } else {
        fading = true;
        setTimeout(() => booted.set(true), 500);
      }
    };

    requestAnimationFrame(tick);
  });
</script>

<div class="boot" class:fade-out={fading}>
  <div class="boot-glow"></div>
  <JarvisHoloConstellations />
  <div class="boot-content">
    <JarvisBootBrand logo3d />
    <div class="boot-progress">
      <div class="boot-progress-bar" style="width: {progress}%"></div>
    </div>
    <p class="boot-status">{status}</p>
  </div>
</div>
