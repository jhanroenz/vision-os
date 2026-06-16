import { writable } from 'svelte/store';

export const booted = writable(false);
export const shutdown = writable(false);
export const startMenuOpen = writable(false);
export const selectedDesktopKey = writable<string | null>(null);

/** @deprecated use selectedDesktopKey */
export const selectedIconId = selectedDesktopKey;

export function setSelectedDesktopKey(key: string) {
  selectedDesktopKey.set(key);
}

export function clearSelectedDesktopKey() {
  selectedDesktopKey.set(null);
}

export interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
}

export const contextMenu = writable<ContextMenuState>({
  open: false,
  x: 0,
  y: 0
});

export function showContextMenu(x: number, y: number) {
  contextMenu.set({ open: true, x, y });
}

export function hideContextMenu() {
  contextMenu.update((m) => ({ ...m, open: false }));
}

export function toggleStartMenu() {
  startMenuOpen.update((v) => !v);
}

export function hideStartMenu() {
  startMenuOpen.set(false);
}

const SHUTDOWN_ANIMATION_TIMEOUT_MS = 4500;

let shutdownAnimationResolver: (() => void) | null = null;

/** Resolved when the shutdown screen finishes its exit animation (Tauri). */
export function waitForShutdownAnimation(): Promise<void> {
  return new Promise((resolve) => {
    shutdownAnimationResolver = resolve;
    window.setTimeout(() => {
      if (shutdownAnimationResolver === resolve) {
        shutdownAnimationResolver = null;
        resolve();
      }
    }, SHUTDOWN_ANIMATION_TIMEOUT_MS);
  });
}

export function completeShutdownAnimation() {
  const resolve = shutdownAnimationResolver;
  shutdownAnimationResolver = null;
  resolve?.();
}
