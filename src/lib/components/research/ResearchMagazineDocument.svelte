<script lang="ts">
  import type {
    ResearchDocument,
    ResearchMediaAsset,
    ResearchSessionDetail,
    ResearchTier
  } from '$lib/api/research';
  import { buildDocumentFromMarkdown } from '$lib/utils/researchDocument';
  import ResearchDocumentSection from './ResearchDocumentSection.svelte';
  import '$lib/styles/research-document.css';

  interface Props {
    session: ResearchSessionDetail;
    media: ResearchMediaAsset[];
    printMode?: boolean;
    onOpenVideo?: (asset: ResearchMediaAsset) => void;
  }

  let { session, media, printMode = false, onOpenVideo }: Props = $props();

  const document = $derived<ResearchDocument | null>(
    session.reportJson?.document ??
      (session.reportMarkdown
        ? buildDocumentFromMarkdown(session.reportMarkdown, session.userQuery, session.tier)
        : null)
  );

  const mediaById = $derived(new Map(media.map((m) => [m.id, m])));

  const templateLabel = $derived(
    document?.templateLabel ??
      session.reportJson?.classification?.documentType ??
      'Research Report'
  );

  const formattedDate = $derived(
    document?.generatedAt
      ? new Date(document.generatedAt).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      : session.completedAt
        ? new Date(session.completedAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })
        : new Date(session.createdAt).toLocaleDateString()
  );

  const stats = $derived({
    sources: document?.stats?.sources ?? session.sourceCount ?? session.reportJson?.stats?.sources ?? 0,
    images: document?.stats?.images ?? media.filter((m) => m.type === 'image').length,
    inlineFigures: document?.stats?.inlineFigures ?? 0,
    tier: (document?.tier ?? session.tier) as ResearchTier
  });

  const showToc = $derived(!printMode && (document?.sections?.length ?? 0) >= 4);
</script>

{#if document}
  <article
    class="research-document"
    class:research-document--print={printMode}
    data-research-document
    data-print-root={printMode ? 'true' : undefined}
  >
    <header class="research-document-masthead">
      <p class="research-document-kicker">{templateLabel}</p>
      <h1 class="research-document-title">{document.title}</h1>
      {#if document.deck}
        <p class="research-document-deck">{document.deck}</p>
      {/if}
      <div class="research-document-stats">
        <span><strong>{stats.sources}</strong> sources</span>
        <span><strong>{stats.images}</strong> images</span>
        {#if stats.inlineFigures > 0}
          <span><strong>{stats.inlineFigures}</strong> inline figures</span>
        {/if}
        <span>{stats.tier} tier</span>
        <span>{formattedDate}</span>
      </div>
    </header>

    {#if showToc}
      <nav class="research-document-toc" aria-label="Table of contents">
        <h3>Contents</h3>
        <ol>
          {#each document.sections as section (section.id)}
            <li>
              <a href={`#section-${section.id}`}>{section.title}</a>
            </li>
          {/each}
        </ol>
      </nav>
    {/if}

    {#each document.sections as section (section.id)}
      <ResearchDocumentSection {section} {mediaById} {printMode} {onOpenVideo} />
    {/each}
  </article>
{/if}
