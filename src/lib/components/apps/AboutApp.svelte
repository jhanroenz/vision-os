<script lang="ts">
  interface Props {
    windowId?: string;
  }

  let { windowId }: Props = $props();
</script>

<div class="app-about">
  <div class="about-logo">◎</div>
  <h2>VisionOS</h2>
  <p class="about-version">Version 0.1.0 · Preview</p>
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
