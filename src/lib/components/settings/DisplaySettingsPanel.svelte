<script lang="ts">
  import { settings, nextWallpaper, prevWallpaper, randomWallpaper } from '$lib/stores/settings';
  import { WALLPAPER_CATALOG, type WallpaperCategory } from '$lib/types';

  const accents = ['#6c5ce7', '#00cec9', '#fd79a8', '#5b8def', '#00b894', '#e17055'];
  let filter = $state<WallpaperCategory | 'all'>('all');

  const filtered = $derived(
    filter === 'all'
      ? WALLPAPER_CATALOG
      : WALLPAPER_CATALOG.filter((w) => w.category === filter)
  );

  const current = $derived(
    WALLPAPER_CATALOG.find((w) => w.id === $settings.wallpaperId)
  );
</script>

<div class="settings-section-panel display-settings-panel">
  <h3 class="settings-section-title">Display</h3>
  <p class="settings-hint">Personalization for the VisionOS desktop shell (saved locally in this browser).</p>

  <section class="display-section">
    <h4>Personalization</h4>
    <label class="modal-field">
      <span>Username</span>
      <input
        type="text"
        value={$settings.username}
        oninput={(e) => settings.patch({ username: e.currentTarget.value })}
      />
    </label>
    <label class="modal-field">
      <span>Accent color</span>
      <div class="accent-swatches">
        {#each accents as color}
          <button
            type="button"
            class="swatch"
            class:active={$settings.accent === color}
            style="background:{color}"
            onclick={() => settings.patch({ accent: color })}
            title={color}
          ></button>
        {/each}
      </div>
    </label>
  </section>

  <section class="display-section">
    <h4>Wallpaper</h4>
    <div class="wp-gallery-controls">
      <div class="wp-filter-tabs">
        <button type="button" class:active={filter === 'all'} onclick={() => (filter = 'all')}>All</button>
        <button type="button" class:active={filter === 'static'} onclick={() => (filter = 'static')}>Static</button>
        <button type="button" class:active={filter === 'animated'} onclick={() => (filter = 'animated')}>Live</button>
      </div>
      <div class="wp-quick-actions">
        <button type="button" class="btn-secondary" onclick={prevWallpaper}>←</button>
        <button type="button" class="btn-secondary" onclick={randomWallpaper}>🎲</button>
        <button type="button" class="btn-secondary" onclick={nextWallpaper}>→</button>
      </div>
    </div>

    <p class="settings-current-wp">
      Current: <strong>{current?.name ?? '—'}</strong>
    </p>

    <div class="wallpaper-grid-picker">
      {#each filtered as wp (wp.id)}
        <button
          type="button"
          class="wp-picker"
          class:active={$settings.wallpaperId === wp.id}
          onclick={() => settings.patch({ wallpaperId: wp.id })}
          title={wp.name}
        >
          <div
            class="wp-preview {wp.type === 'css' ? wp.cssClass : ''}"
            style="background: {wp.preview}"
          ></div>
          <span class="wp-picker-name">{wp.name}</span>
          {#if wp.category === 'animated'}
            <span class="wp-picker-badge">LIVE</span>
          {/if}
        </button>
      {/each}
    </div>

    <label class="modal-field">
      <span>Dim overlay</span>
      <input
        type="range"
        min="0"
        max="0.65"
        step="0.05"
        value={$settings.wallpaperDim}
        oninput={(e) => settings.patch({ wallpaperDim: parseFloat(e.currentTarget.value) })}
      />
    </label>
    <label class="modal-field">
      <span>Animation speed</span>
      <input
        type="range"
        min="0.25"
        max="2.5"
        step="0.25"
        value={$settings.wallpaperSpeed}
        oninput={(e) => settings.patch({ wallpaperSpeed: parseFloat(e.currentTarget.value) })}
      />
    </label>
  </section>

  <section class="display-section">
    <h4>Storage</h4>
    <p class="settings-hint">Settings persist in browser localStorage under <code>visionos_*</code> keys.</p>
    <button type="button" class="btn-danger" onclick={() => settings.reset()}>Reset to defaults</button>
  </section>
</div>
