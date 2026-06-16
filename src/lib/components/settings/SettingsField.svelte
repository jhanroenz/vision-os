<script lang="ts">
  import type { FieldMeta } from '$lib/api/settings';
  import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
  import RestartBadge from './RestartBadge.svelte';

  interface Props {
    field: FieldMeta;
    value: string | number | boolean | undefined;
    disabled?: boolean;
    onchange?: (value: string | number | boolean) => void;
  }

  let { field, value, disabled = false, onchange }: Props = $props();
</script>

{#if field.type === 'boolean'}
  <div class="modal-field modal-field-inline">
    <ToggleSwitch
      checked={Boolean(value)}
      {disabled}
      onchange={(v) => onchange?.(v)}
    >
      {field.label}
      {#if field.restartRequired}<RestartBadge />{/if}
    </ToggleSwitch>
  </div>
{:else}
  <label class="modal-field">
    <span>
      {field.label}
      {#if field.restartRequired}<RestartBadge />{/if}
    </span>

    {#if field.options?.length}
      <select
        {value}
        {disabled}
        onchange={(e) => onchange?.(e.currentTarget.value)}
      >
        {#each field.options as opt}
          <option value={opt}>{opt}</option>
        {/each}
      </select>
    {:else if field.type === 'number'}
      <input
        type="number"
        {value}
        min={field.min}
        max={field.max}
        {disabled}
        oninput={(e) => {
          const v = e.currentTarget.value;
          onchange?.(v === '' ? '' : Number(v));
        }}
      />
    {:else}
      <input
        type="text"
        value={value ?? ''}
        {disabled}
        oninput={(e) => onchange?.(e.currentTarget.value)}
      />
    {/if}

    {#if field.description}
      <span class="field-hint">{field.description}</span>
    {/if}
  </label>
{/if}
