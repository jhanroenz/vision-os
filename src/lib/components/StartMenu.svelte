<script lang="ts">
  import { APPS, openApp } from '$lib/apps/registry';
  import { settings } from '$lib/stores/settings';
  import { startMenuOpen, hideStartMenu } from '$lib/stores/os';
  import { dialogConfirm } from '$lib/stores/dialogs';
  import { exitVisionOS } from '$lib/platform/exit';

  function launch(appId: string) {
    openApp(appId);
    hideStartMenu();
  }

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
      <span class="start-menu-logo">◎</span>
      <div>
        <strong>VisionOS</strong>
        <small>Welcome, {$settings.username}</small>
      </div>
    </header>

    <div class="start-menu-apps">
      {#each APPS as app (app.id)}
        <button class="start-menu-app" onclick={() => launch(app.id)}>
          <span class="app-icon">{app.icon}</span>
          {app.name}
        </button>
      {/each}
    </div>

    <footer class="start-menu-footer">
      <button class="shutdown-btn" onclick={handleShutdown}>⏻ Shut Down</button>
    </footer>
  </div>
{/if}
