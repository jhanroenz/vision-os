<script lang="ts">
  import {
    apiKeyHint,
    apiKeyRequired,
    currentApiKeySet,
    jarvisSettings
  } from '$lib/stores/jarvisSettings';
  import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
  import SettingsField from './SettingsField.svelte';

  const llmExtraKeys = [
    'temperature',
    'slotsEnabled',
    'slotId',
    'streaming',
    'rateLimitMaxRetries',
    'rateLimitBaseBackoffMs',
    'rateLimitMaxBackoffMs'
  ];

  const isCursorProvider = $derived($jarvisSettings.form.provider === 'cursor');

  const llmExtraFields = $derived(
    isCursorProvider
      ? []
      : ($jarvisSettings.sectionMeta.llm ?? []).filter((f) => llmExtraKeys.includes(f.key))
  );

  const previewEffective = $derived.by(() => {
    const form = $jarvisSettings.form;
    if (form.provider === 'local' || !form.rateLimitEnabled) return null;
    let rpm = form.rateLimitRpm === '' ? null : Number(form.rateLimitRpm);
    let rpd = form.rateLimitRpd === '' ? null : Number(form.rateLimitRpd);
    let tpm = form.rateLimitTpm === '' ? null : Number(form.rateLimitTpm);
    let tpd = form.rateLimitTpd === '' ? null : Number(form.rateLimitTpd);
    if (form.rateLimitHeadroom) {
      if (rpm != null) rpm = Math.max(1, rpm - 1);
      if (rpd != null) rpd = Math.max(1, rpd - 50);
      if (tpm != null) tpm = Math.max(1000, tpm - 500);
      if (tpd != null) tpd = Math.max(1000, tpd - 5000);
    }
    if (!rpm && !rpd && !tpm && !tpd) return null;
    return { rpm, rpd, tpm, tpd };
  });

  function onProviderChange(event: Event) {
    const id = (event.target as HTMLSelectElement).value;
    if (id === 'custom') {
      jarvisSettings.updateForm({ provider: 'custom' });
      jarvisSettings.syncApiKeyFieldForProvider();
      return;
    }
    jarvisSettings.applyProviderPreset(id);
  }

  function showApiKeyField() {
    return (
      $apiKeyRequired ||
      ['custom', 'groq', 'openrouter', 'cerebras', 'openai', 'gemini', 'cursor'].includes(
        $jarvisSettings.form.provider
      )
    );
  }

  function updateLlmExtra(key: string, value: string | number | boolean) {
    jarvisSettings.updateSectionValues('llm', { ...$jarvisSettings.sections.llm, [key]: value });
  }

  const disabled = $derived($jarvisSettings.loading || $jarvisSettings.saving);
</script>

<div class="settings-section-panel">
  <h3 class="settings-section-title">LLM</h3>
  <p class="settings-hint">
    {#if isCursorProvider}
      Cursor Composer SDK runs a local agent against your workspace. Use model <code>auto</code>
      (recommended); <code>composer-*</code> models often fail via SDK local runtime.
    {:else}
      Local servers, Groq, OpenRouter, Cerebras, Gemini, OpenAI, Cursor, or any OpenAI-compatible
      API. Changes apply immediately — no server restart needed.
    {/if}
  </p>

  <label class="modal-field">
    <span>Provider</span>
    <select value={$jarvisSettings.form.provider} {disabled} onchange={onProviderChange}>
      {#each $jarvisSettings.providers as p (p.id)}
        <option value={p.id}>{p.label}</option>
      {/each}
      <option value="custom">Custom URL</option>
    </select>
  </label>

  {#if !isCursorProvider}
    <label class="modal-field">
      <span>Base URL</span>
      <input
        type="url"
        value={$jarvisSettings.form.baseURL}
        required
        {disabled}
        oninput={(e) => {
          jarvisSettings.updateForm({ baseURL: e.currentTarget.value });
          jarvisSettings.onBaseUrlInput();
        }}
      />
    </label>
  {:else}
    <p class="field-hint">Cursor SDK — no base URL (local agent on this machine)</p>
  {/if}

  <label class="modal-field">
    <span>Model</span>
    <input
      type="text"
      value={$jarvisSettings.form.model}
      required
      {disabled}
      oninput={(e) => {
        jarvisSettings.updateForm({ model: e.currentTarget.value });
        jarvisSettings.onModelInput();
      }}
    />
  </label>

  <label class="modal-field">
    <span>Context window (tokens)</span>
    <input
      type="number"
      value={$jarvisSettings.form.context}
      min="1024"
      max="2000000"
      step="1024"
      required
      {disabled}
      oninput={(e) => jarvisSettings.updateForm({ context: Number(e.currentTarget.value) })}
    />
  </label>

  {#if showApiKeyField()}
    <label class="modal-field">
      <span>API key</span>
      <input
        type="password"
        autocomplete="off"
        value={$jarvisSettings.form.apiKey}
        placeholder={$currentApiKeySet ? '••••••••  (leave blank to keep saved key)' : 'Paste API key'}
        {disabled}
        oninput={(e) => jarvisSettings.updateForm({ apiKey: e.currentTarget.value })}
      />
      {#if $apiKeyHint}
        <span class="field-hint">{$apiKeyHint}</span>
      {/if}
    </label>
  {/if}

  {#each llmExtraFields as field (field.key)}
    <SettingsField
      {field}
      value={$jarvisSettings.sections.llm?.[field.key] as string | number | boolean | undefined}
      {disabled}
      onchange={(v) => updateLlmExtra(field.key, v)}
    />
  {/each}

  {#if $jarvisSettings.form.provider !== 'local' && !isCursorProvider}
    <hr class="settings-divider" />
    <h3 class="settings-section-title">Rate limits</h3>
    <div class="modal-field modal-field-inline">
      <ToggleSwitch
        checked={$jarvisSettings.form.rateLimitEnabled}
        {disabled}
        onchange={(v) => jarvisSettings.updateForm({ rateLimitEnabled: v })}
      >
        Enable rate limiting
      </ToggleSwitch>
    </div>
    <div class="modal-field modal-field-inline">
      <ToggleSwitch
        checked={$jarvisSettings.form.rateLimitHeadroom}
        disabled={disabled || !$jarvisSettings.form.rateLimitEnabled}
        onchange={(v) => jarvisSettings.updateForm({ rateLimitHeadroom: v })}
      >
        Safety headroom
      </ToggleSwitch>
    </div>
    <div class="settings-rate-grid">
      <label class="modal-field">
        <span>RPM</span>
        <input
          type="number"
          min="1"
          value={$jarvisSettings.form.rateLimitRpm}
          disabled={disabled || !$jarvisSettings.form.rateLimitEnabled}
          oninput={(e) =>
            jarvisSettings.updateForm({
              rateLimitRpm: e.currentTarget.value === '' ? '' : Number(e.currentTarget.value)
            })}
        />
      </label>
      <label class="modal-field">
        <span>RPD</span>
        <input
          type="number"
          min="1"
          value={$jarvisSettings.form.rateLimitRpd}
          disabled={disabled || !$jarvisSettings.form.rateLimitEnabled}
          oninput={(e) =>
            jarvisSettings.updateForm({
              rateLimitRpd: e.currentTarget.value === '' ? '' : Number(e.currentTarget.value)
            })}
        />
      </label>
      <label class="modal-field">
        <span>TPM</span>
        <input
          type="number"
          min="1"
          value={$jarvisSettings.form.rateLimitTpm}
          disabled={disabled || !$jarvisSettings.form.rateLimitEnabled}
          oninput={(e) =>
            jarvisSettings.updateForm({
              rateLimitTpm: e.currentTarget.value === '' ? '' : Number(e.currentTarget.value)
            })}
        />
      </label>
      <label class="modal-field">
        <span>TPD</span>
        <input
          type="number"
          min="1"
          value={$jarvisSettings.form.rateLimitTpd}
          disabled={disabled || !$jarvisSettings.form.rateLimitEnabled}
          oninput={(e) =>
            jarvisSettings.updateForm({
              rateLimitTpd: e.currentTarget.value === '' ? '' : Number(e.currentTarget.value)
            })}
        />
      </label>
    </div>
    {#if previewEffective}
      <p class="field-hint">
        Effective throttle:
        {#if previewEffective.rpm}{previewEffective.rpm} RPM{/if}
        {#if previewEffective.tpm}
          · {previewEffective.tpm.toLocaleString()} TPM
        {/if}
      </p>
    {/if}
    {#if $jarvisSettings.form.provider === 'groq' && $jarvisSettings.rateLimitLive}
      <p class="field-hint groq-live-hint">
        Groq live: {$jarvisSettings.rateLimitLive.remainingTokens?.toLocaleString()} TPM remaining
      </p>
    {/if}
  {/if}
</div>
