<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    checked?: boolean;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
    children?: Snippet;
  }

  let { checked = false, disabled = false, onchange, children }: Props = $props();
</script>

<label class="vos-toggle" class:vos-toggle--disabled={disabled}>
  <input
    type="checkbox"
    class="vos-toggle-input"
    {checked}
    {disabled}
    onchange={(e) => onchange?.(e.currentTarget.checked)}
  />
  <span class="vos-toggle-track" aria-hidden="true"></span>
  {#if children}
    <span class="vos-toggle-label">{@render children()}</span>
  {/if}
</label>
