<script lang="ts">
  import type { ResearchMediaAsset } from '$lib/api/research';
  import '$lib/styles/research.css';

  interface Props {
    media?: ResearchMediaAsset | null;
  }

  let { media = null }: Props = $props();

  const sourceUrl = $derived(media?.embedUrl || media?.url || '');
  const isIframe = $derived(
    Boolean(
      media &&
        sourceUrl &&
        (media.provider === 'youtube' ||
          media.provider === 'vimeo' ||
          media.provider === 'iframe' ||
          !/\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(sourceUrl))
    )
  );
</script>

<div class="research-video-player">
  <header class="research-video-player-header">
    <div class="research-video-player-led" aria-hidden="true"></div>
    <div>
      <strong>{media?.title || 'Research video'}</strong>
      {#if media?.sourcePageUrl}
        <a href={media.sourcePageUrl} target="_blank" rel="noreferrer noopener">Open source</a>
      {/if}
    </div>
  </header>

  <div class="research-video-player-screen">
    {#if sourceUrl}
      {#if isIframe}
        <iframe
          src={sourceUrl}
          title={media?.title || 'Embedded video'}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowfullscreen
          referrerpolicy="no-referrer"
        ></iframe>
      {:else}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={sourceUrl} controls autoplay playsinline preload="metadata"></video>
      {/if}
    {:else}
      <p class="research-media-empty">No video URL available.</p>
    {/if}
  </div>
</div>
