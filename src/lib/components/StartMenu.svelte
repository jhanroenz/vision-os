<script lang="ts">
  import { BUILTIN_APPS, openApp } from '$lib/apps/registry';
  import { userAppsStore } from '$lib/stores/userApps';
  import { settings } from '$lib/stores/settings';
  import { startMenuOpen, hideStartMenu } from '$lib/stores/os';
  import { dialogConfirm } from '$lib/stores/dialogs';
  import { exitVisionOS } from '$lib/platform/exit';
  import VisionOSLogo from '$lib/components/branding/VisionOSLogo.svelte';

  function launch(appId: string) {
    openApp(appId);
    hideStartMenu();
  }

  const builtinApps = BUILTIN_APPS.filter((app) => app.launcher !== false);
  const publishedUserApps = $derived(
    $userAppsStore.apps.filter((a) => a.status === 'published' && a.launcher !== false)
  );
  const draftUserApps = $derived($userAppsStore.apps.filter((a) => a.status === 'draft'));

  async function handleShutdown() {
    const ok = await dialogConfirm({
      title: 'Shut down',
      message: 'Shut down VisionOS?',
      confirmLabel: 'Shut Down',
      destructive: true
    });
    if (!ok) return;
    hideStartMenu();
    await exitVisionOS();
  }
</script>

{#if $startMenuOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="start-menu" onclick={(e) => e.stopPropagation()}>
    <header class="start-menu-header">
      <span class="start-menu-logo"><VisionOSLogo size={38} /></span>
      <div>
        <strong>VisionOS</strong>
        <small>Welcome, {$settings.username}</small>
      </div>
    </header>

    <div class="start-menu-section">
      <h4 class="section-label">Built-in</h4>
      <div class="start-menu-apps">
        {#each builtinApps as app (app.id)}
          <button class="start-menu-app" onclick={() => launch(app.id)}>
            <span class="app-icon">{app.icon}</span>
            {app.name}
          </button>
        {/each}
      </div>
    </div>

    {#if publishedUserApps.length > 0}
      <div class="start-menu-section">
        <h4 class="section-label">My Apps</h4>
        <div class="start-menu-apps launcher-grid">
          {#each publishedUserApps as app (app.id)}
            <button class="start-menu-app launcher-tile" onclick={() => launch(app.id)} title={app.name}>
              <span class="app-icon launcher-icon">{app.icon}</span>
              <span class="launcher-name">{app.name}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if draftUserApps.length > 0}
      <div class="start-menu-section">
        <h4 class="section-label">Drafts</h4>
        <div class="start-menu-apps">
          {#each draftUserApps as app (app.id)}
            <button class="start-menu-app draft-app" onclick={() => launch('userAppsManager')}>
              <span class="app-icon">{app.icon}</span>
              {app.name}
              <span class="draft-badge">draft</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <footer class="start-menu-footer">
      <button class="shutdown-btn" onclick={handleShutdown}>⏻ Shut Down</button>
    </footer>
  </div>
{/if}

<style>
  .start-menu-section {
    margin-bottom: 8px;
  }
  .section-label {
    margin: 8px 16px 4px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.45);
    font-weight: 600;
  }
  .draft-badge {
    margin-left: 6px;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(255, 180, 80, 0.25);
    color: #ffc978;
  }

  :global(.launcher-grid) {
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  :global(.launcher-tile) {
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 8px;
    text-align: center;
  }

  :global(.launcher-icon) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: rgba(108, 92, 231, 0.2);
    font-size: 24px;
  }

  :global(.launcher-name) {
    font-size: 11px;
    line-height: 1.25;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
