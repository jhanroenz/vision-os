<script lang="ts">
  import { onMount } from 'svelte';
  import { booted } from '$lib/stores/os';
  import BootScreenView from '$lib/components/BootScreenView.svelte';

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
        setTimeout(() => booted.set(true), 1000);
      }
    };

    requestAnimationFrame(tick);
  });
</script>

<BootScreenView {progress} {status} {fading} />
