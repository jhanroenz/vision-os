<script lang="ts">
  import BootScreen from '$lib/components/BootScreen.svelte';
  import Desktop from '$lib/components/Desktop.svelte';
  import Taskbar from '$lib/components/Taskbar.svelte';
  import StartMenu from '$lib/components/StartMenu.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import DialogHost from '$lib/components/DialogHost.svelte';
  import ShutdownScreen from '$lib/components/ShutdownScreen.svelte';
  import { booted, shutdown, hideStartMenu, hideContextMenu } from '$lib/stores/os';
  import { shouldSkipSvelteBootScreen } from '$lib/platform/browser';
  import { onMount } from 'svelte';

  if (typeof window !== 'undefined' && shouldSkipSvelteBootScreen()) {
    booted.set(true);
  }

  onMount(() => {
    const onGlobalClick = () => {
      hideStartMenu();
      hideContextMenu();
    };
    window.addEventListener('click', onGlobalClick);
    return () => window.removeEventListener('click', onGlobalClick);
  });
</script>

{#if $shutdown}
  <ShutdownScreen />
{:else if !$booted}
  <BootScreen />
{:else}
  <Desktop />
  <Taskbar />
  <StartMenu />
  <ContextMenu />
  <DialogHost />
{/if}
