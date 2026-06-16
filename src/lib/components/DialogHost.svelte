<script lang="ts">
  import {
    dialogState,
    dialogCancel,
    dialogSubmitPrompt,
    dialogSubmitConfirm,
    dialogSubmitAlert
  } from '$lib/stores/dialogs';
  import '../styles/dialogs.css';

  let inputEl: HTMLInputElement | undefined = $state();
  let inputValue = $state('');

  $effect(() => {
    const dialog = $dialogState;
    if (dialog?.type === 'prompt') {
      inputValue = dialog.defaultValue;
      requestAnimationFrame(() => {
        inputEl?.focus();
        inputEl?.select();
      });
    }
  });

  function onBackdropClick() {
    dialogCancel();
  }

  function onKeyDown(event: KeyboardEvent) {
    const dialog = $dialogState;
    if (!dialog) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      dialogCancel();
      return;
    }

    if (event.key === 'Enter' && dialog.type !== 'prompt') {
      event.preventDefault();
      if (dialog.type === 'confirm') dialogSubmitConfirm();
      else dialogSubmitAlert();
      return;
    }

    if (event.key === 'Enter' && dialog.type === 'prompt' && !event.shiftKey) {
      event.preventDefault();
      dialogSubmitPrompt(inputValue);
    }
  }
</script>

<svelte:window onkeydown={onKeyDown} />

{#if $dialogState}
  {@const dialog = $dialogState}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="vos-dialog-backdrop" onclick={onBackdropClick}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="vos-dialog"
      class:vos-dialog--destructive={dialog.type === 'confirm' && dialog.destructive}
      role="dialog"
      aria-modal="true"
      aria-labelledby="vos-dialog-title"
      onclick={(event) => event.stopPropagation()}
    >
      <div class="vos-dialog-icon" aria-hidden="true">
        {#if dialog.type === 'confirm' && dialog.destructive}
          ⚠
        {:else if dialog.type === 'alert'}
          ℹ
        {:else}
          ✎
        {/if}
      </div>

      <div class="vos-dialog-body">
        <h2 id="vos-dialog-title" class="vos-dialog-title">{dialog.title}</h2>

        {#if dialog.message}
          <p class="vos-dialog-message">{dialog.message}</p>
        {/if}

        {#if dialog.type === 'prompt'}
          <label class="vos-dialog-field">
            <span>{dialog.label}</span>
            <input
              bind:this={inputEl}
              bind:value={inputValue}
              placeholder={dialog.placeholder}
              autocomplete="off"
              spellcheck="false"
            />
          </label>
        {/if}
      </div>

      <div class="vos-dialog-actions">
        {#if dialog.type === 'prompt'}
          <button type="button" class="vos-dialog-btn" onclick={dialogCancel}>
            {dialog.cancelLabel}
          </button>
          <button
            type="button"
            class="vos-dialog-btn vos-dialog-btn--primary"
            onclick={() => dialogSubmitPrompt(inputValue)}
          >
            {dialog.confirmLabel}
          </button>
        {:else if dialog.type === 'confirm'}
          <button type="button" class="vos-dialog-btn" onclick={dialogCancel}>
            {dialog.cancelLabel}
          </button>
          <button
            type="button"
            class="vos-dialog-btn"
            class:vos-dialog-btn--danger={dialog.destructive}
            class:vos-dialog-btn--primary={!dialog.destructive}
            onclick={dialogSubmitConfirm}
          >
            {dialog.confirmLabel}
          </button>
        {:else}
          <button type="button" class="vos-dialog-btn vos-dialog-btn--primary" onclick={dialogSubmitAlert}>
            {dialog.okLabel}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}
