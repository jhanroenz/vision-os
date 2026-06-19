<script lang="ts">
  import type { ResearchSessionDetail, ResearchMediaAsset } from '$lib/api/research';
  import ResearchMagazineDocument from './ResearchMagazineDocument.svelte';

  interface Props {
    session: ResearchSessionDetail;
    media: ResearchMediaAsset[];
  }

  let { session, media }: Props = $props();
</script>

<div class="research-document-print-root" aria-hidden="true">
  <ResearchMagazineDocument {session} {media} printMode />
</div>

<style>
  .research-document-print-root {
    position: fixed;
    left: -10000px;
    top: 0;
    width: 210mm;
    pointer-events: none;
    visibility: hidden;
    z-index: -1;
  }
</style>
