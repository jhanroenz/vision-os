import { writable, derived, get } from 'svelte/store';
import type { WindowState } from '$lib/types';
import { getAppById } from '$lib/apps/registry';

let zCounter = 100;

const internal = writable<WindowState[]>([]);
const { subscribe } = internal;

function focus(id: string) {
  internal.update((windows) => {
    zCounter++;
    return windows.map((w) =>
      w.id === id ? { ...w, zIndex: zCounter } : w
    );
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
      if (existing.minimized) {
        internal.update((ws) =>
          ws.map((w) => (w.id === id ? { ...w, minimized: false } : w))
        );
      }
      return id;
    }

    const count = all.length;
    const width = opts.width ?? app?.defaultWidth ?? 520;
    const height = opts.height ?? app?.defaultHeight ?? 400;

    const win: WindowState = {
      id,
      appId: opts.appId,
      title: opts.title,
      x: opts.x ?? 80 + count * 28,
      y: opts.y ?? 48 + count * 28,
      width,
      height,
      zIndex: ++zCounter,
      minimized: false,
      maximized: false,
      props: opts.props
    };

    internal.update((ws) => [...ws, win]);
    return id;
  },

  close(id: string) {
    internal.update((ws) => ws.filter((w) => w.id !== id));
  },

  minimize(id: string) {
    internal.update((ws) =>
      ws.map((w) => (w.id === id ? { ...w, minimized: true } : w))
    );
  },

  restore(id: string) {
    internal.update((ws) =>
      ws.map((w) => (w.id === id ? { ...w, minimized: false } : w))
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
    internal.update((ws) =>
      ws.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized) {
          const b = w.prevBounds;
          return {
            ...w,
            maximized: false,
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
          prevBounds: { x: w.x, y: w.y, width: w.width, height: w.height },
          x: 0,
          y: 0,
          width: window.innerWidth,
          height: window.innerHeight - 48
        };
      })
    );
    focus(id);
  },

  move(id: string, x: number, y: number) {
    internal.update((ws) =>
      ws.map((w) => (w.id === id && !w.maximized ? { ...w, x, y } : w))
    );
  },

  resize(id: string, width: number, height: number) {
    internal.update((ws) =>
      ws.map((w) =>
        w.id === id && !w.maximized
          ? { ...w, width: Math.max(280, width), height: Math.max(180, height) }
          : w
      )
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
