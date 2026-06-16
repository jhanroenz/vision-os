<script lang="ts">
  import VisionOSLogo from '$lib/components/branding/VisionOSLogo.svelte';

  interface Props {
    windowId?: string;
  }

  let { windowId }: Props = $props();
</script>

<div class="app-welcome">
  <div class="welcome-hero">
    <span class="welcome-icon"><VisionOSLogo size={56} /></span>
    <h2>Welcome to VisionOS</h2>
    <p class="welcome-tagline">The next-generation desktop for Jarvis</p>
  </div>

  <div class="welcome-cards">
    <div class="welcome-card">
      <span class="card-icon">🪟</span>
      <h3>Windowed Apps</h3>
      <p>Drag, resize, and multitask with a full desktop metaphor.</p>
    </div>
    <div class="welcome-card">
      <span class="card-icon">💾</span>
      <h3>Persistent State</h3>
      <p>Settings and app data survive restarts via local storage.</p>
    </div>
    <div class="welcome-card">
      <span class="card-icon">🧠</span>
      <h3>Jarvis Ready</h3>
      <p>Core modules will migrate here — chat, brain, research, and more.</p>
    </div>
  </div>

  <p class="welcome-footer">Double-click desktop icons or use the Start menu to explore.</p>
</div>
