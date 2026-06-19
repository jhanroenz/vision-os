<script lang="ts">
  import VisionOSLogo from '$lib/components/branding/VisionOSLogo.svelte';

  interface Props {
    windowId?: string;
  }

  let { windowId }: Props = $props();
</script>

<div class="app-about">
  <div class="about-logo"><VisionOSLogo size={60} /></div>
  <h2>VisionOS</h2>
  <p class="about-version">Version 1.0.0</p>
  <p class="about-desc">
    A SvelteKit desktop shell for Jarvis — inspired by NovaOS, built for the next wave of agent modules.
  </p>
  <dl class="about-meta">
    <dt>Stack</dt>
    <dd>SvelteKit · Svelte 5 · TypeScript</dd>
    <dt>Persistence</dt>
    <dd>localStorage (visionos_*)</dd>
    <dt>Backend</dt>
    <dd>Jarvis API (modules pending)</dd>
  </dl>
</div>
