<script lang="ts">
  import { onMount } from 'svelte';
  import { research } from '$lib/stores/research';
  import ResearchMagazineDocument from '$lib/components/research/ResearchMagazineDocument.svelte';
  import { openResearchImageViewer, openResearchVideoPlayer } from '$lib/apps/registry';
  import { exportResearchPdf } from '$lib/utils/exportResearchPdf';
  import type { ResearchMediaAsset, ResearchTier } from '$lib/api/research';
  import '$lib/styles/research.css';
  import '$lib/styles/research-document.css';

  let query = $state('');
  let renamingId = $state('');
  let renameValue = $state('');
  let exportingPdf = $state(false);
  let exportStatus = $state('');
  let documentRoot = $state<HTMLElement | null>(null);

  const researchState = $derived($research);
  const active = $derived(researchState.active);
  const mediaItems = $derived(researchState.media ?? []);
  const galleryItems = $derived(mediaItems.filter((item) => item.placement !== 'inline'));
  const imageItems = $derived(galleryItems.filter((item) => item.type === 'image'));
  const videoItems = $derived(galleryItems.filter((item) => item.type === 'video'));

  const canExportPdf = $derived(
    Boolean(active?.reportMarkdown && !researchState.running && (active.status === 'done' || active.completedAt))
  );

  const tiers: ResearchTier[] = ['quick', 'standard', 'deep', 'exhaustive'];

  onMount(() => {
    void research.loadSessions();
  });

  async function submit() {
    const message = query.trim();
    if (!message) return;
    query = '';
    await research.run(message);
  }

  function startRename(id: string, title: string) {
    renamingId = id;
    renameValue = title;
  }

  async function commitRename() {
    if (!renamingId) return;
    await research.rename(renamingId, renameValue);
    renamingId = '';
    renameValue = '';
  }

  function openImage(id: string) {
    const idx = imageItems.findIndex((item) => item.id === id);
    if (idx < 0) return;
    openResearchImageViewer(imageItems, idx);
  }

  function openVideo(item: ResearchMediaAsset) {
    openResearchVideoPlayer(item);
  }

  async function handleExportPdf() {
    if (!documentRoot || !active || exportingPdf) return;
    const target = documentRoot.querySelector('[data-research-document]');
    if (!target || !(target instanceof HTMLElement)) return;
    exportingPdf = true;
    exportStatus = 'Starting export…';
    try {
      await exportResearchPdf({
        element: target,
        title: active.reportJson?.document?.title ?? active.title ?? active.userQuery,
        onProgress: (msg) => {
          exportStatus = msg;
        }
      });
      exportStatus = '';
    } catch (err) {
      exportStatus = err instanceof Error ? err.message : 'PDF export failed';
    } finally {
      exportingPdf = false;
    }
  }
</script>

<div class="research-app">
  <aside class="research-sidebar">
    <div class="research-sidebar-header">
      <h3>Research</h3>
      <button class="chat-toolbar-btn" onclick={() => research.clearActive()}>+ New</button>
    </div>
    <div class="research-session-list">
      {#if researchState.sessions.length === 0}
        <p class="research-empty-list">No research sessions yet.</p>
      {:else}
        {#each researchState.sessions as item (item.id)}
          <div class="research-session-item" class:active={researchState.activeId === item.id}>
            <button class="research-session-open" onclick={() => research.open(item.id)}>
              {#if renamingId === item.id}
                <input
                  class="research-session-title-input"
                  bind:value={renameValue}
                  onblur={commitRename}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') void commitRename();
                    if (e.key === 'Escape') {
                      renamingId = '';
                      renameValue = '';
                    }
                  }}
                />
              {:else}
                <span class="research-session-title">{item.title}</span>
              {/if}
              <span class="research-session-preview">{item.preview || item.userQuery}</span>
            </button>
            <div class="research-session-actions">
              <button class="chat-conv-action" title="Rename" onclick={() => startRename(item.id, item.title)}>
                ✎
              </button>
              <button class="chat-conv-action danger" title="Delete" onclick={() => research.remove(item.id)}>
                ×
              </button>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </aside>

  <section class="research-main">
    <header class="research-header">
      <h2>{active?.title || 'Deep research'}</h2>
      <div class="research-document-toolbar">
        {#if canExportPdf}
          <button
            class="research-export-pdf-btn"
            disabled={exportingPdf}
            onclick={() => void handleExportPdf()}
            title="Export research document as PDF"
          >
            {exportingPdf ? 'Exporting…' : 'Export PDF'}
          </button>
        {/if}
        <div class="research-tier">
          <label for="research-tier-select">Tier</label>
          <select
            id="research-tier-select"
            value={researchState.tier}
            disabled={researchState.running}
            title="Research depth"
            onchange={(e) => research.setTier(e.currentTarget.value as ResearchTier)}
          >
            {#each tiers as tier}
              <option value={tier}>{tier}</option>
            {/each}
          </select>
        </div>
      </div>
    </header>

    {#if exportStatus}
      <p class="research-export-status">{exportStatus}</p>
    {/if}

    <div class="research-content">
      {#if researchState.error}
        <p class="research-error">{researchState.error}</p>
      {/if}

      {#if researchState.running}
        <div class="research-activity">
          <p class="research-activity-title">{researchState.currentAction || 'Researching...'}</p>
          {#if researchState.activity.length > 0}
            <ul>
              {#each researchState.activity.slice(-10) as item (item.id)}
                <li>{item.text}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      {#if active?.userQuery}
        <div class="research-document-query">
          <div class="research-document-query-label">Research query</div>
          {active.userQuery}
        </div>
      {:else if researchState.running && researchState.pendingQuery}
        <div class="research-document-query">
          <div class="research-document-query-label">Research query</div>
          {researchState.pendingQuery}
        </div>
      {/if}

      {#if active?.reportMarkdown}
        <div bind:this={documentRoot}>
          <ResearchMagazineDocument session={active} media={mediaItems} onOpenVideo={openVideo} />
        </div>

        {#if galleryItems.length > 0}
          <section class="research-media-gallery" data-exclude-from-pdf>
            <p class="research-media-archive-label">Media archive</p>
            {#if videoItems.length > 0}
              <div class="research-gallery-section">
                <h4>Videos</h4>
                <div class="research-gallery-grid research-gallery-videos">
                  {#each videoItems as item (item.id)}
                    <button class="research-video-card" onclick={() => openVideo(item)}>
                      <div class="research-video-thumb">
                        {#if item.thumbnailUrl}
                          <img src={item.thumbnailUrl} alt={item.title || 'Video thumbnail'} loading="lazy" />
                        {:else}
                          <span>▶</span>
                        {/if}
                      </div>
                      <div class="research-media-meta">
                        <strong>{item.title || 'Video'}</strong>
                        <span>{item.provider || 'embed'}</span>
                      </div>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            {#if imageItems.length > 0}
              <div class="research-gallery-section">
                <h4>Images</h4>
                <div class="research-gallery-grid research-gallery-images">
                  {#each imageItems as item (item.id)}
                    <button class="research-image-card" onclick={() => openImage(item.id)}>
                      <img src={item.url} alt={item.title || item.caption || 'Research image'} loading="lazy" />
                      <div class="research-media-meta">
                        <strong>{item.title || item.caption || 'Image'}</strong>
                      </div>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </section>
        {/if}
      {:else if !researchState.running}
        <div class="research-placeholder">Start a topic to generate a cited deep research report.</div>
      {/if}
    </div>

    <footer class="research-composer">
      <textarea
        class="chat-composer-input"
        bind:value={query}
        placeholder="Research a topic..."
        rows="3"
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
      ></textarea>
      <button class="chat-send-btn" disabled={researchState.running || !query.trim()} onclick={() => void submit()}>
        {researchState.running ? 'Researching...' : 'Run Research'}
      </button>
    </footer>
  </section>
</div>

<style>
  .research-export-status {
    font-size: 12px;
    color: var(--text-muted);
    padding: 0 16px 8px;
    margin: 0;
  }
</style>
