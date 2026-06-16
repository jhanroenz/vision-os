<script lang="ts">
  import type { FieldMeta } from '$lib/api/settings';
  import SettingsField from './SettingsField.svelte';

  interface Props {
    title: string;
    hint?: string;
    fields: FieldMeta[];
    values: Record<string, unknown>;
    disabled?: boolean;
    onupdate?: (values: Record<string, unknown>) => void;
  }

  let { title, hint = '', fields, values, disabled = false, onupdate }: Props = $props();

  function updateField(key: string, value: string | number | boolean) {
    onupdate?.({ ...values, [key]: value });
  }
</script>

<div class="settings-section-panel">
  <h3 class="settings-section-title">{title}</h3>
  {#if hint}
    <p class="settings-hint">{hint}</p>
  {/if}
  {#each fields as field (field.key)}
    <SettingsField
      {field}
      value={values[field.key] as string | number | boolean | undefined}
      {disabled}
      onchange={(v) => updateField(field.key, v)}
    />
  {/each}
</div>
