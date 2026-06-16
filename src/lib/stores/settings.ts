import { writable, derived, get } from 'svelte/store';
import { loadJson, saveJson, loadString, saveString } from '$lib/persist';
import { DEFAULT_SETTINGS, type OsSettings } from '$lib/types';
import {
  WALLPAPER_CATALOG,
  getWallpaperById,
  resolveWallpaperId
} from '$lib/wallpapers/catalog';

function createSettingsStore() {
  const stored = loadJson<Partial<OsSettings>>('settings', {});
  const initial: OsSettings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    accent: loadString('accent', stored.accent ?? DEFAULT_SETTINGS.accent),
    username: loadString('username', stored.username ?? DEFAULT_SETTINGS.username),
    wallpaperId: resolveWallpaperId(stored.wallpaperId ?? DEFAULT_SETTINGS.wallpaperId)
  };

  const { subscribe, update, set } = writable<OsSettings>(initial);

  function patch(patch: Partial<OsSettings>) {
    update((s) => {
      const next = {
        ...s,
        ...patch,
        ...(patch.wallpaperId !== undefined
          ? { wallpaperId: resolveWallpaperId(patch.wallpaperId) }
          : {})
      };
      saveJson('settings', next);
      if (patch.accent !== undefined) saveString('accent', patch.accent);
      if (patch.username !== undefined) saveString('username', patch.username);
      return next;
    });
  }

  return {
    subscribe,
    patch,
    reset() {
      set({ ...DEFAULT_SETTINGS });
      saveJson('settings', DEFAULT_SETTINGS);
      saveString('accent', DEFAULT_SETTINGS.accent);
      saveString('username', DEFAULT_SETTINGS.username);
    }
  };
}

export const settings = createSettingsStore();

export const currentWallpaper = derived(settings, ($s) => getWallpaperById($s.wallpaperId));

function cycleWallpaper(direction: 1 | -1) {
  const s = get(settings);
  const idx = WALLPAPER_CATALOG.findIndex((w) => w.id === s.wallpaperId);
  const next = WALLPAPER_CATALOG[(idx + direction + WALLPAPER_CATALOG.length) % WALLPAPER_CATALOG.length];
  settings.patch({ wallpaperId: next.id });
}

export function nextWallpaper() {
  cycleWallpaper(1);
}

export function prevWallpaper() {
  cycleWallpaper(-1);
}

export function randomWallpaper() {
  const s = get(settings);
  const next = WALLPAPER_CATALOG[Math.floor(Math.random() * WALLPAPER_CATALOG.length)];
  if (next.id === s.wallpaperId && WALLPAPER_CATALOG.length > 1) {
    cycleWallpaper(1);
  } else {
    settings.patch({ wallpaperId: next.id });
  }
}
