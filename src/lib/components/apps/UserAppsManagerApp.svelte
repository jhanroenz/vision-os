<script lang="ts">
  import { onMount } from 'svelte';
  import { userAppsStore } from '$lib/stores/userApps';
  import { openApp, openAppBuilderChat } from '$lib/apps/registry';
  import { publishUserApp, deleteUserApp } from '$lib/api/userApps';
  import { dialogConfirm } from '$lib/stores/dialogs';
  import { windows } from '$lib/stores/windows';
  import type { UserAppRecord } from '$lib/types';

  onMount(() => {
    void userAppsStore.sync();
  });

  const publishedApps = $derived($userAppsStore.apps.filter((a) => a.status === 'published'));
  const draftApps = $derived($userAppsStore.apps.filter((a) => a.status === 'draft'));

  function openUserApp(app: UserAppRecord) {
    openApp(app.id);
  }

  function handleAddApp() {
    openAppBuilderChat();
  }

  async function handlePublish(slug: string, event: MouseEvent) {
    event.stopPropagation();
    await publishUserApp(slug);
    await userAppsStore.sync();
  }

  async function handleUninstall(app: UserAppRecord, event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    const ok = await dialogConfirm({
      title: 'Uninstall app',
      message: `Uninstall "${app.name}"? This removes the app from My Apps and deletes its files.`,
      confirmLabel: 'Uninstall',
      destructive: true
    });
    if (!ok) return;
    windows.closeByAppId(app.id);
    await deleteUserApp(app.slug);
    await userAppsStore.sync();
  }
</script>

<div class="launcher">
  <header class="launcher-header">
    <div>
      <h2>My Apps</h2>
      <p class="subtitle">Tap an app to open it</p>
    </div>
    <div class="header-actions">
      <button type="button" class="add-btn" onclick={handleAddApp}>+ Add App</button>
      <button type="button" class="refresh-btn" onclick={() => userAppsStore.sync()}>Refresh</button>
    </div>
  </header>

  {#if $userAppsStore.error}
    <p class="error">{$userAppsStore.error}</p>
  {/if}

  {#if publishedApps.length === 0 && draftApps.length === 0}
    <p class="empty">No apps yet. Click <strong>Add App</strong> to open App Builder in Chat.</p>
  {/if}

  {#if publishedApps.length > 0}
    <div class="app-grid">
      {#each publishedApps as app (app.id)}
        <div class="app-tile-wrap">
          <button type="button" class="app-tile" onclick={() => openUserApp(app)} title={app.name}>
            <span class="app-logo">{app.icon}</span>
            <span class="app-name">{app.name}</span>
          </button>
          <button
            type="button"
            class="uninstall-btn"
            aria-label="Uninstall {app.name}"
            title="Uninstall"
            onclick={(e) => handleUninstall(app, e)}
          >
            ×
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if draftApps.length > 0}
    <h3 class="section-title">Drafts</h3>
    <div class="app-grid drafts">
      {#each draftApps as app (app.id)}
        <div class="app-tile-wrap draft">
          <button type="button" class="app-tile" onclick={() => openUserApp(app)} title={app.name}>
            <span class="app-logo">{app.icon}</span>
            <span class="app-name">{app.name}</span>
          </button>
          <button
            type="button"
            class="uninstall-btn"
            aria-label="Uninstall {app.name}"
            title="Uninstall"
            onclick={(e) => handleUninstall(app, e)}
          >
            ×
          </button>
          <div class="draft-actions">
            <button type="button" class="mini-btn" onclick={(e) => handlePublish(app.slug, e)}>Publish</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .launcher {
    padding: 20px 24px;
    height: 100%;
    overflow: auto;
    color: #e8ecf4;
    font-family: system-ui, sans-serif;
    background:
      radial-gradient(circle at top right, rgba(108, 92, 231, 0.12), transparent 45%),
      transparent;
  }

  .launcher-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 20px;
  }

  h2 {
    margin: 0;
    font-size: 22px;
    color: #f0f2ff;
  }

  .subtitle {
    margin: 4px 0 0;
    font-size: 13px;
    color: #8b95a8;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .add-btn {
    padding: 8px 14px;
    border: 0;
    border-radius: 8px;
    background: rgba(108, 92, 231, 0.95);
    color: white;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }

  .add-btn:hover {
    background: rgba(124, 108, 245, 1);
  }

  .refresh-btn {
    padding: 8px 14px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    color: #e8ecf4;
    cursor: pointer;
    font-size: 13px;
  }

  .refresh-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .section-title {
    margin: 24px 0 12px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #8b95a8;
    font-weight: 600;
  }

  .app-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
    gap: 14px;
  }

  .app-tile-wrap {
    position: relative;
  }

  .app-tile-wrap:hover .uninstall-btn {
    opacity: 1;
  }

  .app-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    min-height: 118px;
    padding: 16px 10px 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    cursor: pointer;
    transition:
      transform 0.15s ease,
      background 0.15s ease,
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }

  .app-tile:hover {
    transform: translateY(-2px);
    background: rgba(108, 92, 231, 0.14);
    border-color: rgba(108, 92, 231, 0.35);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
  }

  .uninstall-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgba(20, 22, 30, 0.85);
    color: #ff8fa8;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s ease, background 0.15s ease;
    z-index: 2;
  }

  .uninstall-btn:hover {
    background: rgba(255, 107, 138, 0.9);
    color: white;
  }

  .app-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: 14px;
    background: linear-gradient(145deg, rgba(108, 92, 231, 0.35), rgba(255, 255, 255, 0.08));
    font-size: 28px;
    line-height: 1;
  }

  .app-name {
    font-size: 12px;
    font-weight: 500;
    text-align: center;
    line-height: 1.3;
    max-width: 100%;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .app-tile-wrap.draft {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .app-tile-wrap.draft .app-tile:hover {
    transform: none;
    box-shadow: none;
  }

  .draft-actions {
    display: flex;
    gap: 6px;
    width: 100%;
    padding: 0 4px;
  }

  .mini-btn {
    flex: 1;
    padding: 5px 0;
    border: 0;
    border-radius: 6px;
    background: rgba(108, 92, 231, 0.85);
    color: white;
    font-size: 11px;
    cursor: pointer;
  }

  .empty,
  .error {
    font-size: 14px;
  }

  .empty {
    color: #8b95a8;
    margin: 24px 0;
  }

  .error {
    color: #ff6b8a;
  }
</style>
