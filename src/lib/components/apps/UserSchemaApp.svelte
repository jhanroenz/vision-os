<script lang="ts">
  import { onMount } from 'svelte';
  import { getAppData, submitSchemaAction, callUserAppSdk } from '$lib/api/userApps';
  import { openApp } from '$lib/apps/registry';
  import {
    formatStatValue,
    loadBlockValue,
    submitFormBlock,
    type SchemaBlock,
    type SchemaDocument
  } from '$lib/userApps/schemaRenderer';

  interface Props {
    slug?: string;
    userAppId?: string;
  }

  let { slug: slugProp = '', userAppId = '' }: Props = $props();

  const slug = $derived(slugProp || userAppId.replace(/^user:/, ''));
  let schema = $state<SchemaDocument | null>(null);
  let values = $state<Record<string, Record<string, unknown>>>({});
  let listData = $state<Record<string, unknown[]>>({});
  let statData = $state<Record<string, unknown>>({});
  let error = $state('');
  let loading = $state(true);

  async function loadSchema() {
    loading = true;
    error = '';
    try {
      const html = await fetch(`/api/user-apps/${encodeURIComponent(slug)}/serve/schema.json`).then((r) =>
        r.text()
      );
      schema = JSON.parse(html) as SchemaDocument;
      await refreshData();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function refreshData() {
    if (!schema) return;
    for (const block of schema.blocks) {
      if (block.type === 'stat' || block.type === 'list' || block.type === 'form') {
        const key = block.key ?? block.field ?? 'data';
        const val = await loadBlockValue(slug, key);
        if (block.type === 'list') listData[key] = Array.isArray(val) ? val : [];
        else if (block.type === 'stat') statData[key] = val;
        else if (block.type === 'form') {
          const key = block.key ?? 'formData';
          if (!values[key]) values[key] = {};
          if (val && typeof val === 'object') values[key] = val as Record<string, unknown>;
          for (const field of block.fields ?? []) {
            if (values[key][field.name] === undefined) {
              values[key][field.name] = field.default ?? '';
            }
          }
        }
      }
    }
  }

  async function onSubmit(blockKey: string, block: SchemaBlock) {
    const data = values[blockKey] ?? {};
    await submitFormBlock(slug, block, data);
    await refreshData();
  }

  async function onButton(block: SchemaBlock) {
    if (block.action === 'openApp' && block.appId) {
      openApp(block.appId);
      return;
    }
    if (block.action === 'agent.prompt' && block.message) {
      await callUserAppSdk(slug, 'agent.prompt', { message: block.message });
    }
  }

  onMount(() => {
    void loadSchema();
  });
</script>

<div class="schema-app">
  {#if loading}
    <p class="muted">Loading…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if schema}
    {#if schema.title}
      <h2>{schema.title}</h2>
    {/if}
    {#each schema.blocks as block, i (i)}
      {#if block.type === 'markdown'}
        <div class="markdown">{block.text ?? ''}</div>
      {:else if block.type === 'stat'}
        {@const key = block.key ?? 'value'}
        <div class="stat">
          <span class="label">{block.label ?? key}</span>
          <strong>{formatStatValue(statData[key])}</strong>
        </div>
      {:else if block.type === 'list'}
        {@const key = block.key ?? 'items'}
        <div class="list-block">
          <h3>{block.label ?? key}</h3>
          <table>
            <tbody>
              {#each listData[key] ?? [] as row, ri (ri)}
                <tr>
                  {#if typeof row === 'object' && row}
                    {#each Object.values(row as Record<string, unknown>) as cell}
                      <td>{formatStatValue(cell)}</td>
                    {/each}
                  {:else}
                    <td>{formatStatValue(row)}</td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else if block.type === 'form'}
        {@const key = block.key ?? 'formData'}
        <form
          class="form-block"
          onsubmit={(e) => {
            e.preventDefault();
            void onSubmit(key, block);
          }}
        >
          <h3>{block.label ?? block.title ?? 'Form'}</h3>
          {#each block.fields ?? [] as field (field.name)}
            <label>
              {field.label ?? field.name}
              {#if field.input === 'textarea'}
                <textarea bind:value={values[key][field.name]}></textarea>
              {:else}
                <input
                  type={field.input === 'number' ? 'number' : 'text'}
                  bind:value={values[key][field.name]}
                />
              {/if}
            </label>
          {/each}
          <button type="submit">Save</button>
        </form>
      {:else if block.type === 'button'}
        <button type="button" onclick={() => void onButton(block)}>{block.label ?? 'Run'}</button>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .schema-app {
    padding: 16px;
    height: 100%;
    overflow: auto;
    color: #e8ecf4;
    font-family: system-ui, sans-serif;
  }
  .muted {
    color: #8b95a8;
  }
  .error {
    color: #ff6b8a;
  }
  h2 {
    margin-top: 0;
    color: #6c5ce7;
  }
  .stat {
    display: flex;
    justify-content: space-between;
    padding: 12px;
    margin: 8px 0;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
  }
  .label {
    color: #8b95a8;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  td {
    padding: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .form-block label {
    display: block;
    margin-bottom: 10px;
  }
  input,
  textarea {
    display: block;
    width: 100%;
    margin-top: 4px;
    padding: 8px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.25);
    color: inherit;
  }
  button {
    margin-top: 8px;
    padding: 8px 14px;
    border-radius: 6px;
    border: 0;
    background: #6c5ce7;
    color: white;
    cursor: pointer;
  }
  .markdown {
    white-space: pre-wrap;
    line-height: 1.6;
    margin: 12px 0;
  }
</style>
