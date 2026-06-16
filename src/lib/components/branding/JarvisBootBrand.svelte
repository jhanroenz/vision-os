<script lang="ts">
  import VisionOSLogo from '$lib/components/branding/VisionOSLogo.svelte';
  import VisionOSLogo3D from '$lib/components/branding/VisionOSLogo3D.svelte';

  interface Props {
    logoSize?: number;
    logo3d?: boolean;
    speed?: number;
  }

  let { logoSize = 88, logo3d = false, speed = 1 }: Props = $props();
</script>

<div class="boot-logo">
  <div class="boot-logo-mark">
    {#if logo3d}
      <VisionOSLogo3D size={logoSize} {speed} />
    {:else}
      <VisionOSLogo size={logoSize} boot />
    {/if}
  </div>
  <h1>
    <span class="boot-logo-word">Vision</span>
    <span class="boot-logo-sep" aria-hidden="true"></span>
    <span class="boot-logo-word">OS</span>
  </h1>
  <p>Jarvis Desktop Interface</p>
</div>
