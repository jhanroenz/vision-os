<script lang="ts">
  import UserSandboxApp from './UserSandboxApp.svelte';
  import UserSchemaApp from './UserSchemaApp.svelte';
  import { getAppById } from '$lib/apps/registry';

  interface Props {
    windowId?: string;
    userAppId?: string;
    slug?: string;
  }

  let { windowId, userAppId = '', slug: slugProp }: Props = $props();

  const app = $derived(getAppById(userAppId));
  const slug = $derived(slugProp || userAppId.replace(/^user:/, ''));
  const userType = $derived(app?.userType ?? 'sandbox');
</script>

{#if userType === 'schema'}
  <UserSchemaApp {userAppId} {slug} />
{:else if userType === 'service'}
  <div class="service-app">
    <p>This service app runs in the background.</p>
    <p class="muted">Manage jobs in App Manager.</p>
  </div>
{:else}
  <UserSandboxApp {windowId} {userAppId} {slug} />
{/if}

<style>
  .service-app {
    padding: 24px;
    color: #e8ecf4;
    font-family: system-ui, sans-serif;
  }
  .muted {
    color: #8b95a8;
  }
</style>
