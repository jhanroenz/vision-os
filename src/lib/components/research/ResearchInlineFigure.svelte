<script lang="ts">
  import type { ResearchMediaAsset } from '$lib/api/research';

  interface Props {
    asset: ResearchMediaAsset;
    caption?: string;
    printMode?: boolean;
    onOpenVideo?: (asset: ResearchMediaAsset) => void;
  }

  let { asset, caption = '', printMode = false, onOpenVideo }: Props = $props();

  const displayCaption = $derived(caption || asset.caption || asset.title || '');
  const credit = $derived(asset.sourcePageUrl ? new URL(asset.sourcePageUrl).hostname : '');
</script>

<figure class="research-document-figure" class:research-document-figure--video={asset.type === 'video'}>
  {#if asset.type === 'video' && !printMode}
    <button
      type="button"
      class="research-document-video-thumb"
      onclick={() => onOpenVideo?.(asset)}
      aria-label={`Play video: ${displayCaption || 'Video'}`}
    >
      {#if asset.thumbnailUrl}
        <img src={asset.thumbnailUrl} alt={displayCaption || 'Video thumbnail'} loading="lazy" />
      {:else}
        <img src={asset.url} alt={displayCaption || 'Video'} loading="lazy" />
      {/if}
      <span class="research-document-video-play" aria-hidden="true">▶</span>
    </button>
  {:else if asset.type === 'video' && printMode}
    {#if asset.thumbnailUrl}
      <img src={asset.thumbnailUrl} alt={displayCaption || 'Video thumbnail'} />
    {/if}
  {:else}
    <img src={asset.url} alt={displayCaption || 'Research figure'} loading="lazy" />
  {/if}
  {#if displayCaption || credit}
    <figcaption>
      {#if displayCaption}
        <strong>{displayCaption}</strong>
      {/if}
      {#if credit}
        <span class="research-document-figure-credit">Source: {credit}</span>
      {/if}
    </figcaption>
  {/if}
</figure>
