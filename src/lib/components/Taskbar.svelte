<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { windows, activeWindowId } from '$lib/stores/windows';
  import { startMenuOpen, toggleStartMenu, hideStartMenu } from '$lib/stores/os';
  import { getAppById, openApp } from '$lib/apps/registry';
  import { settings } from '$lib/stores/settings';

  let clock = $state('');
  let date = $state('');
  let interval: ReturnType<typeof setInterval>;

  function updateClock() {
    const now = new Date();
    clock = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    date = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  onMount(() => {
    updateClock();
    interval = setInterval(updateClock, 1000);
  });

  onDestroy(() => clearInterval(interval));

  function handleStartClick(e: MouseEvent) {
    e.stopPropagation();
    toggleStartMenu();
  }
</script>

<footer class="taskbar">
  <button
    class="start-btn"
    class:active={$startMenuOpen}
    onclick={handleStartClick}
    title="Start"
  >
    <span class="start-icon">◎</span>
    <span>Vision</span>
  </button>

  <div class="taskbar-apps">
    {#each $windows as win (win.id)}
      {@const app = getAppById(win.appId)}
      <button
        class="taskbar-app-btn"
        class:active={$activeWindowId === win.id && !win.minimized}
        class:minimized={win.minimized}
        onclick={() => windows.toggleMinimize(win.id)}
      >
        <span>{app?.icon ?? '◻'}</span>
        <span class="taskbar-label">{win.title}</span>
      </button>
    {/each}
  </div>

  <div class="system-tray">
    <button
      class="tray-btn"
      title="Jarvis settings"
      onclick={() => openApp('settings', { props: { initialSection: 'llm' } })}
    >🤖</button>
    <div class="tray-clock">
      <div>{clock}</div>
      <small>{date}</small>
    </div>
  </div>
</footer>
