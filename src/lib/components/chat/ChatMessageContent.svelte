<script lang="ts">
  import { browser } from '$app/environment';
  import { renderMarkdown } from '$lib/utils/markdown';
  import '$lib/styles/chat-prose.css';

  interface Props {
    content: string;
    markdown?: boolean;
  }

  let { content, markdown = false }: Props = $props();

  const html = $derived(
    markdown && browser && content.trim() ? renderMarkdown(content) : ''
  );
</script>

{#if markdown && html}
  <div class="chat-message-prose">{@html html}</div>
{:else}
  <div class="chat-message-plain">{content}</div>
{/if}
