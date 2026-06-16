<script lang="ts">
  import { onMount } from 'svelte';
  import {
    jarvisSettings,
    JARVIS_NAV_ITEMS,
    SECTION_HINTS,
    type JarvisSectionId
  } from '$lib/stores/jarvisSettings';
  import DisplaySettingsPanel from '$lib/components/settings/DisplaySettingsPanel.svelte';
  import LlmSettingsSection from '$lib/components/settings/LlmSettingsSection.svelte';
  import SettingsFieldsSection from '$lib/components/settings/SettingsFieldsSection.svelte';
  import '$lib/styles/jarvis-settings.css';

  interface Props {
    windowId?: string;
    initialSection?: JarvisSectionId;
  }

  let { windowId, initialSection = 'display' }: Props = $props();

  onMount(() => {
    if (initialSection && initialSection !== 'display') {
      jarvisSettings.setActiveSection(initialSection);
    }
    jarvisSettings.load();
  });

  const isJarvisSection = $derived($jarvisSettings.activeSection !== 'display');
  const activeLabel = $derived(
    JARVIS_NAV_ITEMS.find((n) => n.id === $jarvisSettings.activeSection)?.label ??
      $jarvisSettings.activeSection
  );
  const fields = $derived($jarvisSettings.sectionMeta[$jarvisSettings.activeSection] ?? []);
  const values = $derived($jarvisSettings.sections[$jarvisSettings.activeSection] ?? {});
  const hint = $derived(SECTION_HINTS[$jarvisSettings.activeSection] ?? '');
  const actionsDisabled = $derived(
    $jarvisSettings.loading || $jarvisSettings.saving || $jarvisSettings.testing
  );
</script>

<div class="jarvis-settings-app">
  <header class="settings-overlay-header">
    <h2>Settings</h2>
    <div class="settings-overlay-actions">
      {#if $jarvisSettings.activeSection === 'llm'}
        <button
          type="button"
          class="small-btn"
          disabled={actionsDisabled}
          onclick={() => jarvisSettings.testConnection()}
        >
          {$jarvisSettings.testing ? 'Testing…' : 'Test connection'}
        </button>
      {/if}
      {#if isJarvisSection}
        <button
          type="button"
          class="small-btn"
          disabled={$jarvisSettings.loading || $jarvisSettings.saving}
          onclick={() => jarvisSettings.resetSection()}
        >
          Reset section
        </button>
        <button
          type="button"
          class="small-btn primary"
          disabled={$jarvisSettings.loading || $jarvisSettings.saving}
          onclick={() => jarvisSettings.save()}
        >
          {$jarvisSettings.saving ? 'Saving…' : 'Save'}
        </button>
      {/if}
    </div>
  </header>

  <div class="settings-overlay-body">
    <nav class="settings-nav" aria-label="Settings sections">
      {#each JARVIS_NAV_ITEMS as item (item.id)}
        <button
          type="button"
          class="settings-nav-btn"
          class:active={$jarvisSettings.activeSection === item.id}
          onclick={() => jarvisSettings.setActiveSection(item.id)}
        >
          {item.label}
        </button>
      {/each}
    </nav>

    <div class="settings-content">
      {#if $jarvisSettings.loading && isJarvisSection}
        <p class="settings-hint">Loading…</p>
      {:else if $jarvisSettings.activeSection === 'display'}
        <DisplaySettingsPanel />
      {:else if $jarvisSettings.activeSection === 'llm'}
        <LlmSettingsSection />
      {:else}
        <SettingsFieldsSection
          title={activeLabel}
          {hint}
          {fields}
          {values}
          disabled={$jarvisSettings.loading || $jarvisSettings.saving}
          onupdate={(v) => jarvisSettings.updateSectionValues($jarvisSettings.activeSection, v)}
        />
      {/if}

      {#if $jarvisSettings.error}
        <p class="settings-error">{$jarvisSettings.error}</p>
      {/if}
      {#if $jarvisSettings.testResult?.ok}
        <p class="settings-success">
          Connected — {$jarvisSettings.testResult.provider} / {$jarvisSettings.testResult.model}
        </p>
      {:else if $jarvisSettings.testResult && !$jarvisSettings.testResult.ok}
        <p class="settings-error">{$jarvisSettings.testResult.error ?? 'Connection failed'}</p>
      {/if}
    </div>
  </div>

  <footer class="settings-overlay-footer">
    <span>
      Source: <strong>{$jarvisSettings.meta.source === 'database' ? 'database' : 'defaults'}</strong>
      {#if $jarvisSettings.meta.updatedAt}
        · updated {new Date($jarvisSettings.meta.updatedAt).toLocaleString()}
      {/if}
    </span>
    {#if $jarvisSettings.meta.restartPending?.length}
      <span class="settings-restart-hint">
        Restart server for: {$jarvisSettings.meta.restartPending.join(', ')}
      </span>
    {/if}
  </footer>
</div>
