<script lang="ts">
  import { tick } from 'svelte';
  import { getTranscriptDownloadUrl } from '$lib/api/transcript';
  import { transcriptStore } from '$lib/stores/transcript';
  import { windows } from '$lib/stores/windows';
  import {
    formatTranscriptTime,
    prettyJson,
    transcriptEntrySummary,
    transcriptStreamLabel,
    transcriptTypeGroup,
    transcriptTypeLabel
  } from '$lib/utils/transcriptFormat';
  import {
    buildTranscriptViewEntries,
    transcriptViewTypeGroup,
    type TranscriptViewEntry
  } from '$lib/utils/transcriptView';
  import '$lib/styles/transcript.css';

  interface Props {
    conversationId: string;
    windowId?: string;
  }

  let { conversationId, windowId = '' }: Props = $props();

  let typeFilter = $state('all');
  let search = $state('');
  let scrollEl = $state<HTMLDivElement | null>(null);
  let stickToLatest = $state(true);
  let lastViewSignature = $state('');

  const FILTER_OPTIONS = [
    { id: 'all', label: 'All' },
    { id: 'turn', label: 'Turns' },
    { id: 'llm', label: 'LLM' },
    { id: 'tool', label: 'Tools' },
    { id: 'coding', label: 'Coding' },
    { id: 'stream', label: 'Stream' },
    { id: 'system', label: 'Errors' }
  ];

  const state = $derived(
    $transcriptStore[conversationId] ?? {
      loading: false,
      refreshing: false,
      error: null,
      meta: null,
      entries: [],
      tail: 800,
      turnFile: ''
    }
  );

  const turnOptions = $derived([
    { value: '', label: 'Full conversation' },
    ...(state.meta?.turnFiles ?? []).map((f) => ({ value: f, label: f }))
  ]);

  const viewEntries = $derived(
    buildTranscriptViewEntries(state.entries, { activeTurn: state.meta?.activeTurn })
  );

  function matchesFilter(item: TranscriptViewEntry): boolean {
    if (typeFilter !== 'all' && transcriptViewTypeGroup(item) !== typeFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    if (item.kind === 'stream') {
      const hay = `${item.type} ${item.text} ${prettyJson(item.chunks)}`.toLowerCase();
      return hay.includes(q);
    }
    const entry = item.entry;
    const hay = `${entry.type} ${transcriptEntrySummary(entry)} ${prettyJson(entry.data ?? entry)}`.toLowerCase();
    return hay.includes(q);
  }

  const displayEntries = $derived([...viewEntries.filter(matchesFilter)].reverse());

  const hasTranscript = $derived((state.meta?.totalLines ?? 0) > 0);

  function viewSignature(items: TranscriptViewEntry[]): string {
    return items
      .map((item) => {
        if (item.kind === 'stream') {
          return `${item.id}:${item.text.length}:${item.chunkCount}:${item.streaming}`;
        }
        return `${item.id}`;
      })
      .join('|');
  }

  function onScroll() {
    if (!scrollEl) return;
    stickToLatest = scrollEl.scrollTop < 80;
  }

  async function scrollToLatestIfNeeded() {
    if (!stickToLatest || !scrollEl) return;
    await tick();
    scrollEl.scrollTop = 0;
  }

  $effect(() => {
    const signature = viewSignature(viewEntries);
    if (signature !== lastViewSignature) {
      lastViewSignature = signature;
      void scrollToLatestIfNeeded();
    }
  });

  const windowState = $derived($windows.find((win) => win.id === windowId) ?? null);
  const liveActive = $derived(Boolean(conversationId && windowState && !windowState.minimized));

  $effect(() => {
    if (!conversationId) return;
    transcriptStore.startLive(conversationId);
    return () => transcriptStore.stopLive(conversationId);
  });

  $effect(() => {
    if (!conversationId) return;
    if (liveActive) transcriptStore.resumeLive(conversationId);
    else transcriptStore.pauseLive(conversationId);
  });
</script>

<div class="app-transcript">
  {#if !conversationId}
    <div class="transcript-empty-state">Open transcript from the Chat window.</div>
  {:else}
    <header class="transcript-header">
      <div>
        <h2>Transcript</h2>
        <p class="transcript-subtitle">{conversationId.slice(0, 8)}…</p>
      </div>
      <span class="transcript-live-badge">Live</span>
    </header>

    <div class="transcript-meta">
      {#if state.meta?.totalLines}
        <span>{state.meta.totalLines} lines</span>
      {/if}
      {#if state.meta?.updatedAt}
        <span>Updated {formatTranscriptTime(state.meta.updatedAt)}</span>
      {/if}
      {#if state.meta?.activeTurn}
        <span class="transcript-meta-live">Active turn</span>
      {:else if !hasTranscript && !state.loading}
        <span>No transcript yet</span>
      {/if}
      {#if state.refreshing}
        <span>Refreshing…</span>
      {/if}
    </div>

    <div class="transcript-toolbar">
      <label class="transcript-toolbar-field">
        <span>Scope</span>
        <select
          value={state.turnFile}
          disabled={state.loading && !state.entries.length}
          onchange={(e) => void transcriptStore.setTurnFile(conversationId, e.currentTarget.value)}
        >
          {#each turnOptions as opt (opt.value || 'full')}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </label>
      <label class="transcript-toolbar-field">
        <span>Lines</span>
        <select
          value={state.tail}
          disabled={state.loading && !state.entries.length}
          onchange={(e) => void transcriptStore.setTail(conversationId, Number(e.currentTarget.value))}
        >
          <option value={200}>200</option>
          <option value={500}>500</option>
          <option value={800}>800</option>
          <option value={1500}>1500</option>
          <option value={3000}>3000</option>
          <option value={5000}>5000</option>
        </select>
      </label>
      <label class="transcript-toolbar-field">
        <span>Search</span>
        <input bind:value={search} type="search" placeholder="Filter…" />
      </label>
      <div class="transcript-toolbar-actions">
        {#if hasTranscript}
          <a
            class="transcript-toolbar-btn"
            href={getTranscriptDownloadUrl(conversationId)}
            target="_blank"
            rel="noreferrer"
          >
            Download
          </a>
        {:else}
          <button class="transcript-toolbar-btn" type="button" disabled>Download</button>
        {/if}
      </div>
    </div>

    <div class="transcript-filters">
      {#each FILTER_OPTIONS as opt (opt.id)}
        <button
          type="button"
          class="transcript-filter-chip"
          class:active={typeFilter === opt.id}
          onclick={() => (typeFilter = opt.id)}
        >
          {opt.label}
        </button>
      {/each}
    </div>

    <div class="transcript-body" bind:this={scrollEl} onscroll={onScroll}>
      {#if state.error}
        <p class="transcript-error">{state.error}</p>
      {:else if state.loading && !state.entries.length}
        <p class="transcript-status">Loading transcript…</p>
      {:else if !displayEntries.length}
        <p class="transcript-status">
          {state.entries.length ? 'No entries match the filter.' : 'Waiting for transcript events…'}
        </p>
      {:else}
        {#each displayEntries as item (item.id)}
          {#if item.kind === 'stream'}
            <article
              class="transcript-entry transcript-entry--{transcriptViewTypeGroup(item)}"
              class:transcript-entry--streaming={item.streaming}
            >
              <div class="transcript-entry-head">
                <span class="transcript-type-badge">
                  {transcriptStreamLabel(item.type, item.chunkCount, item.streaming)}
                </span>
                <time class="transcript-time">{formatTranscriptTime(item.endTs)}</time>
                {#if item.endSeq != null}
                  <span class="transcript-seq">#{item.startSeq}–#{item.endSeq}</span>
                {/if}
              </div>
              <div class="transcript-stream-body">
                {item.text}
                {#if item.streaming}
                  <span class="transcript-stream-cursor" aria-hidden="true"></span>
                {/if}
              </div>
              <details class="transcript-details">
                <summary>Raw ({item.chunkCount} chunks)</summary>
                <pre class="transcript-payload">{prettyJson(item.chunks.map((c) => c.data))}</pre>
              </details>
            </article>
          {:else}
            {@const entry = item.entry}
            <article class="transcript-entry transcript-entry--{transcriptTypeGroup(entry.type)}">
              <div class="transcript-entry-head">
                <span class="transcript-type-badge">{transcriptTypeLabel(entry.type)}</span>
                <time class="transcript-time">{formatTranscriptTime(entry.ts)}</time>
                {#if entry.seq != null}
                  <span class="transcript-seq">#{entry.seq}</span>
                {/if}
              </div>
              {#if transcriptEntrySummary(entry)}
                <p class="transcript-summary">{transcriptEntrySummary(entry)}</p>
              {/if}
              <details class="transcript-details">
                <summary>Raw</summary>
                <pre class="transcript-payload">{prettyJson(entry.data ?? entry)}</pre>
              </details>
            </article>
          {/if}
        {/each}
      {/if}
    </div>
  {/if}
</div>
