<script lang="ts">
  import { onMount } from 'svelte';
  import { isTauri } from '$lib/platform/browser';
  import { completeShutdownAnimation } from '$lib/stores/os';

  const statuses = [
    'Closing open windows...',
    'Flushing workspace...',
    'Stopping services...',
    'Shutting down VisionOS...'
  ];

  const tauri = isTauri();
  const duration = 2400;

  let progress = $state(100);
  let status = $state(statuses[0]);
  let fading = $state(false);

  onMount(() => {
    if (!tauri) return;

    const start = performance.now();

    const tick = () => {
      const elapsed = performance.now() - start;
      const ratio = Math.min(1, elapsed / duration);
      progress = Math.max(0, 100 - ratio * 100);
      const idx = Math.min(statuses.length - 1, Math.floor(ratio * statuses.length));
      status = statuses[idx];

      if (elapsed < duration) {
        requestAnimationFrame(tick);
        return;
      }

      progress = 0;
      status = 'Goodbye';
      fading = true;
      window.setTimeout(() => completeShutdownAnimation(), 450);
    };

    requestAnimationFrame(tick);
  });
</script>

<div class="shutdown-screen" class:fade-out={fading}>
  <div class="shutdown-glow"></div>
  <div class="shutdown-content">
    <div class="shutdown-ring">
      <span class="shutdown-icon">◎</span>
    </div>
    <h2>VisionOS</h2>

    {#if tauri}
      <div class="shutdown-progress">
        <div class="shutdown-progress-bar" style="width: {progress}%"></div>
      </div>
      <p class="shutdown-status">{status}</p>
    {:else}
      <p class="shutdown-message">It's now safe to close this tab.</p>
      <button class="btn-primary" onclick={() => location.reload()}>Restart</button>
    {/if}
  </div>
</div>
