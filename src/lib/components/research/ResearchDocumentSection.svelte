<script lang="ts">
  import { browser } from '$app/environment';
  import { renderMarkdown } from '$lib/utils/markdown';
  import type { ResearchDocumentSection, ResearchMediaAsset } from '$lib/api/research';
  import ResearchInlineFigure from './ResearchInlineFigure.svelte';

  interface Props {
    section: ResearchDocumentSection;
    mediaById: Map<string, ResearchMediaAsset>;
    printMode?: boolean;
    onOpenVideo?: (asset: ResearchMediaAsset) => void;
  }

  let { section, mediaById, printMode = false, onOpenVideo }: Props = $props();

  const bodyHtml = $derived(
    browser && section.bodyMarkdown?.trim() ? renderMarkdown(section.bodyMarkdown) : ''
  );

  const figures = $derived(section.figures ?? []);
</script>

<section class="research-document-section" id={`section-${section.id}`}>
  <h2 class="research-document-section-title">{section.title}</h2>

  {#if bodyHtml}
    <div class="research-document-section-body">{@html bodyHtml}</div>
  {/if}

  {#each figures as figure (figure.mediaId)}
    {@const asset = mediaById.get(figure.mediaId)}
    {#if asset}
      <ResearchInlineFigure
        {asset}
        caption={figure.caption}
        {printMode}
        {onOpenVideo}
      />
    {/if}
  {/each}
</section>
