import type { WindowState } from '$lib/types';

export const TASKBAR_HEIGHT = 48;
const MIN_TILE_WIDTH = 220;
const MIN_TILE_HEIGHT = 160;

export type SnapZone = 'left' | 'right' | 'top';
export type TileDividerOrientation = 'vertical' | 'horizontal';

export interface TileDivider {
  id: string;
  orientation: TileDividerOrientation;
  index: number;
  position: number;
}

let tileOrder: string[] = [];
const tileSnapZones = new Map<string, SnapZone>();

let gridCols = 2;
let gridRows = 1;
let colEdges: number[] = [0, 0, 0];
let rowEdges: number[] = [0, 0];
let lastDesktopW = 0;
let lastDesktopH = 0;

function desktopSize() {
  return {
    width: window.innerWidth,
    height: window.innerHeight - TASKBAR_HEIGHT
  };
}

function syncOrder(ws: WindowState[]) {
  tileOrder = tileOrder.filter((id) => ws.some((w) => w.id === id && w.tiled && !w.minimized));
  for (const id of [...tileSnapZones.keys()]) {
    if (!tileOrder.includes(id)) tileSnapZones.delete(id);
  }
}

function gridDims(n: number, singleZone?: SnapZone) {
  if (n === 1) {
    if (singleZone === 'top') return { cols: 1, rows: 2 };
    return { cols: 2, rows: 1 };
  }
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  return { cols, rows };
}

function equalEdges(segments: number, total: number): number[] {
  const edges = [0];
  for (let i = 1; i < segments; i++) {
    edges.push(Math.round((total * i) / segments));
  }
  edges.push(total);
  return edges;
}

function scaleEdges(dw: number, dh: number) {
  if (lastDesktopW <= 0 || lastDesktopH <= 0) return;
  const sx = dw / lastDesktopW;
  const sy = dh / lastDesktopH;
  colEdges = colEdges.map((x, i) =>
    i === colEdges.length - 1 ? dw : Math.round(x * sx)
  );
  rowEdges = rowEdges.map((y, i) =>
    i === rowEdges.length - 1 ? dh : Math.round(y * sy)
  );
}

function ensureGrid(n: number, dw: number, dh: number) {
  const zone = n === 1 ? tileSnapZones.get(tileOrder[0]!) ?? 'left' : undefined;
  const { cols, rows } = gridDims(n, zone);
  const dimsChanged = cols !== gridCols || rows !== gridRows;

  if (dimsChanged) {
    gridCols = cols;
    gridRows = rows;
    colEdges = equalEdges(cols, dw);
    rowEdges = equalEdges(rows, dh);
  } else if (dw !== lastDesktopW || dh !== lastDesktopH) {
    if (lastDesktopW > 0 && lastDesktopH > 0) {
      scaleEdges(dw, dh);
    } else {
      colEdges = equalEdges(cols, dw);
      rowEdges = equalEdges(rows, dh);
    }
  }

  colEdges[colEdges.length - 1] = dw;
  rowEdges[rowEdges.length - 1] = dh;
  lastDesktopW = dw;
  lastDesktopH = dh;
}

function cellForWindow(id: string, idx: number, n: number): { col: number; row: number } {
  if (n === 1) {
    const zone = tileSnapZones.get(id) ?? 'left';
    if (zone === 'right') return { col: 1, row: 0 };
    return { col: 0, row: 0 };
  }
  return { col: idx % gridCols, row: Math.floor(idx / gridCols) };
}

function cellRect(col: number, row: number) {
  return {
    x: colEdges[col]!,
    y: rowEdges[row]!,
    width: colEdges[col + 1]! - colEdges[col]!,
    height: rowEdges[row + 1]! - rowEdges[row]!
  };
}

function previewGridForCount(n: number, zone: SnapZone, dw: number, dh: number) {
  const { cols, rows } = gridDims(n, n === 1 ? zone : undefined);
  return {
    cols,
    rows,
    colEdges: equalEdges(cols, dw),
    rowEdges: equalEdges(rows, dh)
  };
}

export function previewSnapRect(
  zone: SnapZone,
  ws: WindowState[],
  draggingId: string
): { x: number; y: number; width: number; height: number } {
  const { width: dw, height: dh } = desktopSize();
  const order = tileOrder.filter(
    (id) => id !== draggingId && ws.some((w) => w.id === id && w.tiled && !w.minimized)
  );
  const nextOrder = zone === 'left' ? [draggingId, ...order] : [...order, draggingId];
  const n = nextOrder.length;
  const idx = nextOrder.indexOf(draggingId);
  const grid = previewGridForCount(n, zone, dw, dh);
  let col: number;
  let row: number;
  if (n === 1) {
    col = zone === 'right' ? 1 : 0;
    row = 0;
  } else {
    col = idx % grid.cols;
    row = Math.floor(idx / grid.cols);
  }
  return {
    x: grid.colEdges[col]!,
    y: grid.rowEdges[row]!,
    width: grid.colEdges[col + 1]! - grid.colEdges[col]!,
    height: grid.rowEdges[row + 1]! - grid.rowEdges[row]!
  };
}

function applyRects(ws: WindowState[]): WindowState[] {
  syncOrder(ws);
  const { width: dw, height: dh } = desktopSize();
  const order = [...tileOrder];
  if (order.length === 0) return ws;

  ensureGrid(order.length, dw, dh);

  return ws.map((w) => {
    const idx = order.indexOf(w.id);
    if (idx === -1 || !w.tiled || w.minimized) return w;
    const { col, row } = cellForWindow(w.id, idx, order.length);
    return { ...w, maximized: false, ...cellRect(col, row) };
  });
}

export function insertTiledWindow(id: string, zone: SnapZone, ws: WindowState[]): WindowState[] {
  syncOrder(ws);
  tileSnapZones.set(id, zone);

  if (!tileOrder.includes(id)) {
    if (zone === 'left') tileOrder.unshift(id);
    else tileOrder.push(id);
  }

  const next = ws.map((w) => {
    if (w.id !== id) return w;
    return {
      ...w,
      tiled: true,
      maximized: false,
      prevBounds: w.prevBounds ?? { x: w.x, y: w.y, width: w.width, height: w.height }
    };
  });

  return applyRects(next);
}

export function removeTiledWindow(id: string, ws: WindowState[]): WindowState[] {
  tileOrder = tileOrder.filter((tid) => tid !== id);
  tileSnapZones.delete(id);
  return applyRects(ws);
}

export function relayoutTiledWindows(ws: WindowState[]): WindowState[] {
  syncOrder(ws);
  return applyRects(ws);
}

export function resizeTileDivider(
  orientation: TileDividerOrientation,
  index: number,
  clientX: number,
  clientY: number,
  ws: WindowState[]
): WindowState[] {
  syncOrder(ws);
  if (tileOrder.length === 0) return ws;
  const { width: dw, height: dh } = desktopSize();
  ensureGrid(tileOrder.length, dw, dh);

  if (orientation === 'vertical') {
    if (index <= 0 || index >= colEdges.length - 1) return ws;
    const min = colEdges[index - 1]! + MIN_TILE_WIDTH;
    const max = colEdges[index + 1]! - MIN_TILE_WIDTH;
    colEdges[index] = Math.max(min, Math.min(max, clientX));
  } else {
    if (index <= 0 || index >= rowEdges.length - 1) return ws;
    const min = rowEdges[index - 1]! + MIN_TILE_HEIGHT;
    const max = rowEdges[index + 1]! - MIN_TILE_HEIGHT;
    rowEdges[index] = Math.max(min, Math.min(max, clientY));
  }

  return applyRects(ws);
}

export function getTileDividers(ws: WindowState[]): TileDivider[] {
  syncOrder(ws);
  if (tileOrder.length === 0) return [];

  const { width: dw, height: dh } = desktopSize();
  ensureGrid(tileOrder.length, dw, dh);

  const dividers: TileDivider[] = [];

  for (let i = 1; i < colEdges.length - 1; i++) {
    dividers.push({
      id: `v-${i}`,
      orientation: 'vertical',
      index: i,
      position: colEdges[i]!
    });
  }

  for (let i = 1; i < rowEdges.length - 1; i++) {
    dividers.push({
      id: `h-${i}`,
      orientation: 'horizontal',
      index: i,
      position: rowEdges[i]!
    });
  }

  return dividers;
}
