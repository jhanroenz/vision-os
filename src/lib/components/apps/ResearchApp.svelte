<script lang="ts">
  import { onMount } from 'svelte';
  import { research } from '$lib/stores/research';
  import ChatMessageContent from '$lib/components/chat/ChatMessageContent.svelte';
  import { openResearchImageViewer, openResearchVideoPlayer } from '$lib/apps/registry';
  import type { ResearchMediaAsset, ResearchTier } from '$lib/api/research';
  import '$lib/styles/research.css';

  let query = $state('');
  let renamingId = $state('');
  let renameValue = $state('');

  const state = $derived($research);
  const active = $derived(state.active);
  const mediaItems = $derived(state.media ?? []);
  const imageItems = $derived(mediaItems.filter((item) => item.type === 'image'));
  const videoItems = $derived(mediaItems.filter((item) => item.type === 'video'));

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
</script>

<div class="research-app">
  <aside class="research-sidebar">
    <div class="research-sidebar-header">
      <h3>Research</h3>
      <button class="chat-toolbar-btn" onclick={() => research.clearActive()}>+ New</button>
    </div>
    <div class="research-session-list">
      {#if state.sessions.length === 0}
        <p class="research-empty-list">No research sessions yet.</p>
      {:else}
        {#each state.sessions as item (item.id)}
          <div class="research-session-item" class:active={state.activeId === item.id}>
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
      <div class="research-tier">
        <label for="research-tier-select">Tier</label>
        <select
          id="research-tier-select"
          value={state.tier}
          disabled={state.running}
          title="Research depth"
          onchange={(e) => research.setTier(e.currentTarget.value as ResearchTier)}
        >
          {#each tiers as tier}
            <option value={tier}>{tier}</option>
          {/each}
        </select>
      </div>
    </header>

    <div class="research-content">
      {#if state.error}
        <p class="research-error">{state.error}</p>
      {/if}

      {#if state.running}
        <div class="research-activity">
          <p class="research-activity-title">{state.currentAction || 'Researching...'}</p>
          {#if state.activity.length > 0}
            <ul>
              {#each state.activity.slice(-10) as item (item.id)}
                <li>{item.text}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      {#if active?.userQuery}
        <article class="chat-message-row user">
          <div class="chat-message-avatar" aria-hidden="true">◉</div>
          <div class="chat-message-body">
            <div class="chat-message-meta"><span class="chat-message-author">You</span></div>
            <div class="chat-message-bubble">{active.userQuery}</div>
          </div>
        </article>
      {:else if state.running && state.pendingQuery}
        <article class="chat-message-row user">
          <div class="chat-message-avatar" aria-hidden="true">◉</div>
          <div class="chat-message-body">
            <div class="chat-message-meta"><span class="chat-message-author">You</span></div>
            <div class="chat-message-bubble">{state.pendingQuery}</div>
          </div>
        </article>
      {/if}

      {#if active?.reportMarkdown}
        <article class="chat-message-row assistant">
          <div class="chat-message-avatar" aria-hidden="true">◎</div>
          <div class="chat-message-body">
            <div class="chat-message-meta"><span class="chat-message-author">Jarvis Research</span></div>
            <div class="chat-message-bubble chat-message-bubble--markdown">
              <ChatMessageContent content={active.reportMarkdown} markdown />
            </div>
          </div>
        </article>

        {#if mediaItems.length > 0}
          <section class="research-media-gallery">
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
      {:else if !state.running}
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
      <button class="chat-send-btn" disabled={state.running || !query.trim()} onclick={() => void submit()}>
        {state.running ? 'Researching...' : 'Run Research'}
      </button>
    </footer>
  </section>
</div>
