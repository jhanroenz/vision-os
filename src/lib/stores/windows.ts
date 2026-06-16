import { writable, derived, get } from 'svelte/store';
import type { WindowState } from '$lib/types';
import { getAppById } from '$lib/apps/registry';
import {
  TASKBAR_HEIGHT,
  insertTiledWindow,
  removeTiledWindow,
  relayoutTiledWindows,
  resizeTileDivider as applyTileDividerResize,
  getTileDividers,
  type SnapZone
} from '$lib/stores/tileLayout';

let zCounter = 100;
const MIN_WINDOW_WIDTH = 280;
const MIN_WINDOW_HEIGHT = 180;
const WINDOW_TITLEBAR_HEIGHT = 38;

function clampWindowPosition(x: number, y: number, width: number, height: number) {
  const maxX = Math.max(0, window.innerWidth - width);
  const maxY = Math.max(0, window.innerHeight - TASKBAR_HEIGHT - height);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY)
  };
}

const internal = writable<WindowState[]>([]);
const { subscribe } = internal;

function focus(id: string) {
  internal.update((windows) => {
    const maxZ = windows.reduce((max, w) => Math.max(max, w.zIndex), 0);
    const target = windows.find((w) => w.id === id);
    if (!target || target.zIndex >= maxZ) return windows;
    zCounter++;
    return windows.map((w) => (w.id === id ? { ...w, zIndex: zCounter } : w));
  });
}

export const windows = {
  subscribe,

  focus,

  open(opts: {
    id?: string;
    appId: string;
    title: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    props?: Record<string, unknown>;
  }) {
    const app = getAppById(opts.appId);
    const id = opts.id ?? `${opts.appId}-${Date.now()}`;
    const all = get(internal);
    const existing = all.find((w) => w.id === id);

    if (existing) {
      focus(id);
      internal.update((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          const next = { ...w, minimized: false };
          if (opts.props) {
            next.props = { ...(w.props ?? {}), ...opts.props };
          }
          return next;
        })
      );
      return id;
    }

    const count = all.length;
    const width = opts.width ?? app?.defaultWidth ?? 520;
    const height = opts.height ?? app?.defaultHeight ?? 400;

    const initialX = opts.x ?? 80 + count * 28;
    const initialY = opts.y ?? 48 + count * 28;
    const pos = clampWindowPosition(initialX, initialY, width, height);

    const win: WindowState = {
      id,
      appId: opts.appId,
      title: opts.title,
      x: pos.x,
      y: pos.y,
      width,
      height,
      zIndex: ++zCounter,
      minimized: false,
      maximized: false,
      tiled: false,
      props: opts.props
    };

    internal.update((ws) => [...ws, win]);
    return id;
  },

  close(id: string) {
    internal.update((ws) => removeTiledWindow(id, ws.filter((w) => w.id !== id)));
  },

  minimize(id: string) {
    internal.update((ws) =>
      relayoutTiledWindows(ws.map((w) => (w.id === id ? { ...w, minimized: true } : w)))
    );
  },

  restore(id: string) {
    internal.update((ws) =>
      relayoutTiledWindows(ws.map((w) => (w.id === id ? { ...w, minimized: false } : w)))
    );
    focus(id);
  },

  toggleMinimize(id: string) {
    const win = get(internal).find((w) => w.id === id);
    if (!win) return;
    if (win.minimized) {
      windows.restore(id);
    } else {
      windows.minimize(id);
    }
  },

  toggleMaximize(id: string) {
    internal.update((ws) => {
      const updated = ws.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized) {
          const b = w.prevBounds;
          return {
            ...w,
            maximized: false,
            tiled: false,
            x: b?.x ?? w.x,
            y: b?.y ?? w.y,
            width: b?.width ?? w.width,
            height: b?.height ?? w.height,
            prevBounds: undefined
          };
        }
        return {
          ...w,
          maximized: true,
          tiled: false,
          prevBounds: { x: w.x, y: w.y, width: w.width, height: w.height },
          x: 0,
          y: 0,
          width: window.innerWidth,
          height: window.innerHeight - TASKBAR_HEIGHT
        };
      });
      return relayoutTiledWindows(removeTiledWindow(id, updated));
    });
    focus(id);
  },

  /** Restore a maximized window and position it under the cursor for titlebar drag. */
  restoreFromMaximizeDrag(id: string, clientX: number, clientY: number) {
    let nextBounds = { x: 0, y: 0, width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT };
    internal.update((ws) => {
      const updated = ws.map((w) => {
        if (w.id !== id || !w.maximized) return w;
        const restored = w.prevBounds ?? {
          x: w.x,
          y: w.y,
          width: Math.min(MIN_WINDOW_WIDTH * 2, Math.round(window.innerWidth * 0.7)),
          height: Math.min(MIN_WINDOW_HEIGHT * 2, Math.round((window.innerHeight - TASKBAR_HEIGHT) * 0.75))
        };
        const ratio = clientX / Math.max(window.innerWidth, 1);
        const x = clientX - ratio * restored.width;
        const y = clientY - WINDOW_TITLEBAR_HEIGHT / 2;
        const pos = clampWindowPosition(x, y, restored.width, restored.height);
        nextBounds = {
          x: pos.x,
          y: pos.y,
          width: restored.width,
          height: restored.height
        };
        return {
          ...w,
          maximized: false,
          tiled: false,
          x: pos.x,
          y: pos.y,
          width: restored.width,
          height: restored.height,
          prevBounds: undefined
        };
      });
      return relayoutTiledWindows(removeTiledWindow(id, updated));
    });
    focus(id);
    return nextBounds;
  },

  snap(id: string, zone: SnapZone) {
    internal.update((ws) => insertTiledWindow(id, zone, ws));
    focus(id);
  },

  untile(id: string, restorePrevBounds = false) {
    internal.update((ws) => {
      let updated = ws.map((w) => {
        if (w.id !== id || !w.tiled) return w;
        if (restorePrevBounds && w.prevBounds) {
          return {
            ...w,
            tiled: false,
            x: w.prevBounds.x,
            y: w.prevBounds.y,
            width: w.prevBounds.width,
            height: w.prevBounds.height,
            prevBounds: undefined
          };
        }
        return { ...w, tiled: false };
      });
      updated = removeTiledWindow(id, updated);
      return updated;
    });
  },

  resizeTileDivider(
    orientation: 'vertical' | 'horizontal',
    index: number,
    clientX: number,
    clientY: number
  ) {
    internal.update((ws) => applyTileDividerResize(orientation, index, clientX, clientY, ws));
  },

  relayoutTiled() {
    internal.update((ws) => relayoutTiledWindows(ws));
  },

  move(id: string, x: number, y: number) {
    internal.update((ws) =>
      ws.map((w) => (w.id === id && !w.maximized && !w.tiled ? { ...w, x, y } : w))
    );
  },

  resize(
    id: string,
    width: number,
    height: number,
    position?: { x: number; y: number }
  ) {
    internal.update((ws) =>
      ws.map((w) => {
        if (w.id !== id || w.maximized || w.tiled) return w;
        const nextWidth = Math.max(MIN_WINDOW_WIDTH, width);
        const nextHeight = Math.max(MIN_WINDOW_HEIGHT, height);
        const nextX = position?.x ?? w.x;
        const nextY = position?.y ?? w.y;
        const pos = clampWindowPosition(nextX, nextY, nextWidth, nextHeight);
        return { ...w, x: pos.x, y: pos.y, width: nextWidth, height: nextHeight };
      })
    );
  },

  setTitle(id: string, title: string) {
    internal.update((ws) => ws.map((w) => (w.id === id ? { ...w, title } : w)));
  }
};

export const activeWindowId = derived(internal, ($ws) => {
  if ($ws.length === 0) return null;
  return [...$ws].sort((a, b) => b.zIndex - a.zIndex)[0]?.id ?? null;
});

export const visibleWindows = derived(internal, ($ws) =>
  $ws.filter((w) => !w.minimized)
);

export const tileDividers = derived(internal, ($ws) => getTileDividers($ws));
