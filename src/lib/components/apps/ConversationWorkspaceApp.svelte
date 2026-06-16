<script lang="ts">
  import { onMount } from 'svelte';
  import { WorkspaceFS, normalizeWorkspacePath, type WorkspaceEntry } from '$lib/api/workspace';

  interface Props {
    conversationId: string;
    windowId?: string;
  }

  let { conversationId }: Props = $props();

  let path = $state('.');
  let entries = $state<WorkspaceEntry[]>([]);
  let workspaceRoot = $state('');
  let loading = $state(false);
  let error = $state<string | null>(null);

  const context = $derived({ threadId: conversationId });

  async function load(nextPath = path) {
    loading = true;
    error = null;
    try {
      const listing = await WorkspaceFS.list(nextPath, context);
      entries = listing.entries;
      path = normalizeWorkspacePath(listing.path);
      workspaceRoot = listing.workspace;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function open(entry: WorkspaceEntry) {
    if (entry.type !== 'dir') return;
    void load(entry.path);
  }

  onMount(() => {
    if (!conversationId) return;
    void load('.');
  });
</script>

<div class="app-conversation-workspace">
  {#if !conversationId}
    <p class="settings-error">This window needs a conversation context. Open workspace from a conversation window.</p>
  {:else}
  <div class="conversation-workspace-toolbar">
    <button class="btn-secondary" onclick={() => void load('.')}>Root</button>
    <button class="btn-secondary" onclick={() => void load(path === '.' ? '.' : path.split('/').slice(0, -1).join('/') || '.')}>Up</button>
    <span class="settings-hint">{workspaceRoot}/{path}</span>
  </div>

  {#if loading}
    <p class="settings-hint">Loading workspace...</p>
  {:else if error}
    <p class="settings-error">{error}</p>
  {:else}
    <div class="conversation-workspace-list">
      {#each entries as entry (entry.path)}
        <button class="conversation-workspace-entry" onclick={() => open(entry)}>
          <span>{entry.type === 'dir' ? '📁' : '📄'} {entry.name}</span>
          <small>{entry.path}</small>
        </button>
      {/each}
    </div>
  {/if}
  {/if}
</div>
