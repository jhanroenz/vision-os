<script lang="ts">
  import { onMount } from 'svelte';
  import { userAppServeUrl } from '$lib/api/userApps';
  import { handleSandboxSdkMessage, postSdkResponse } from '$lib/userApps/sdk';
  import type { SdkMessage } from '$lib/userApps/sdk';

  interface Props {
    windowId?: string;
    userAppId?: string;
    slug?: string;
  }

  let { userAppId = '', slug: slugProp }: Props = $props();

  let frameEl = $state<HTMLIFrameElement | null>(null);
  const slug = $derived(slugProp || userAppId.replace(/^user:/, ''));
  const serveUrl = $derived(userAppServeUrl(slug, 'index.html'));

  onMount(() => {
    const origin = window.location.origin;
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== origin) return;
      const data = event.data as SdkMessage;
      if (!data || data.source !== 'visionos-app') return;
      const response = await handleSandboxSdkMessage(slug, data, origin);
      postSdkResponse(frameEl, origin, response);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });
</script>

<iframe
  bind:this={frameEl}
  class="user-sandbox-frame"
  title="User App"
  src={serveUrl}
  sandbox="allow-scripts allow-same-origin allow-forms"
></iframe>

<style>
  .user-sandbox-frame {
    width: 100%;
    height: 100%;
    border: 0;
    background: #0f1525;
  }
</style>
