<script lang="ts">
  import '../app.css';
  import { settings } from '$lib/stores/settings';
</script>

<svelte:head>
  <title>VisionOS</title>
</svelte:head>

<div style="--accent: {$settings.accent}; --accent-glow: {$settings.accent}73; --accent-dark: {$settings.accent}">
  <slot />
</div>
