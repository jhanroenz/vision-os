<script lang="ts">
  import type { ResearchMediaAsset } from '$lib/api/research';
  import '$lib/styles/research.css';

  interface Props {
    mediaItems?: ResearchMediaAsset[];
    index?: number;
  }

  let { mediaItems = [], index = 0 }: Props = $props();
  let activeIndex = $state(0);

  const images = $derived(mediaItems.filter((item) => item.type === 'image'));
  const active = $derived(images[activeIndex] ?? null);

  function prev() {
    activeIndex = Math.max(0, activeIndex - 1);
  }

  function next() {
    activeIndex = Math.min(images.length - 1, activeIndex + 1);
  }

  $effect(() => {
    activeIndex = index;
  });
</script>

<div class="research-image-viewer">
  {#if active}
    <div class="research-image-stage">
      <img src={active.url} alt={active.title || active.caption || 'Research image'} />
    </div>
    <footer class="research-image-toolbar">
      <div class="research-image-meta">
        <strong>{active.title || active.caption || 'Image'}</strong>
        {#if active.sourcePageUrl}
          <a href={active.sourcePageUrl} target="_blank" rel="noreferrer noopener">Open source</a>
        {/if}
      </div>
      {#if images.length > 1}
        <div class="research-image-controls">
          <button onclick={prev} disabled={activeIndex <= 0}>Prev</button>
          <span>{activeIndex + 1} / {images.length}</span>
          <button onclick={next} disabled={activeIndex >= images.length - 1}>Next</button>
        </div>
      {/if}
    </footer>
  {:else}
    <p class="research-media-empty">No image selected.</p>
  {/if}
</div>
