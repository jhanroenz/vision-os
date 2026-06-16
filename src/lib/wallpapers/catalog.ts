export type WallpaperCategory = 'static' | 'animated';
export type WallpaperType = 'gradient' | 'css' | 'canvas';
export type CanvasRenderer =
  | 'starfield'
  | 'particles'
  | 'matrix'
  | 'neonGrid'
  | 'bubbles'
  | 'fireflies';

export interface WallpaperDefinition {
  id: string;
  name: string;
  category: WallpaperCategory;
  type: WallpaperType;
  preview: string;
  css?: string;
  cssClass?: string;
  renderer?: CanvasRenderer;
}

export const WALLPAPER_CATALOG: WallpaperDefinition[] = [
  {
    id: 'ocean-dusk',
    name: 'Ocean Dusk',
    category: 'static',
    type: 'gradient',
    preview: 'linear-gradient(160deg, #1a2744, #2d4a7c, #0f1f3d)',
    css: 'linear-gradient(160deg, #1a2744 0%, #2d4a7c 40%, #1e3a5f 70%, #0f1f3d 100%)'
  },
  {
    id: 'nebula',
    name: 'Nebula',
    category: 'static',
    type: 'gradient',
    preview: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
    css: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)'
  },
  {
    id: 'emerald',
    name: 'Emerald',
    category: 'static',
    type: 'gradient',
    preview: 'linear-gradient(160deg, #134e5e, #71b280)',
    css: 'linear-gradient(160deg, #134e5e 0%, #71b280 100%)'
  },
  {
    id: 'midnight',
    name: 'Midnight',
    category: 'static',
    type: 'gradient',
    preview: 'linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)',
    css: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)'
  },
  {
    id: 'ember',
    name: 'Ember',
    category: 'static',
    type: 'gradient',
    preview: 'linear-gradient(160deg, #2c1810, #8b4513, #3d2314)',
    css: 'linear-gradient(160deg, #2c1810 0%, #8b4513 50%, #3d2314 100%)'
  },
  {
    id: 'rose-gold',
    name: 'Rose Gold',
    category: 'static',
    type: 'gradient',
    preview: 'linear-gradient(135deg, #2d1b2e, #b76e79, #3d2c3e)',
    css: 'linear-gradient(135deg, #2d1b2e 0%, #5c3a4a 40%, #b76e79 70%, #3d2c3e 100%)'
  },
  {
    id: 'aurora',
    name: 'Aurora',
    category: 'animated',
    type: 'css',
    cssClass: 'wp-aurora',
    preview: 'linear-gradient(135deg, #0a1628, #1a6b5a, #4a3f8c)'
  },
  {
    id: 'sunset-shift',
    name: 'Sunset Shift',
    category: 'animated',
    type: 'css',
    cssClass: 'wp-sunset',
    preview: 'linear-gradient(135deg, #1a0533, #ff6b35, #2d1b4e)'
  },
  {
    id: 'cosmic-mesh',
    name: 'Cosmic Mesh',
    category: 'animated',
    type: 'css',
    cssClass: 'wp-mesh',
    preview: 'linear-gradient(135deg, #0d0221, #6b2fa0, #26408b)'
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    category: 'animated',
    type: 'css',
    cssClass: 'wp-synthwave',
    preview: 'linear-gradient(180deg, #1a0a2e, #ff2a6d)'
  },
  {
    id: 'starfield',
    name: 'Starfield',
    category: 'animated',
    type: 'canvas',
    renderer: 'starfield',
    preview: 'radial-gradient(circle, #1a2744, #050810)'
  },
  {
    id: 'particles',
    name: 'Particle Flow',
    category: 'animated',
    type: 'canvas',
    renderer: 'particles',
    preview: 'radial-gradient(circle, #141c2e, #0a0e17)'
  },
  {
    id: 'matrix',
    name: 'Matrix Rain',
    category: 'animated',
    type: 'canvas',
    renderer: 'matrix',
    preview: 'linear-gradient(180deg, #000, #001a00)'
  },
  {
    id: 'neon-grid',
    name: 'Neon Grid',
    category: 'animated',
    type: 'canvas',
    renderer: 'neonGrid',
    preview: 'linear-gradient(180deg, #0a0014, #1a0030)'
  },
  {
    id: 'bubbles',
    name: 'Bubbles',
    category: 'animated',
    type: 'canvas',
    renderer: 'bubbles',
    preview: 'linear-gradient(160deg, #0c1445, #1a3a6b)'
  },
  {
    id: 'fireflies',
    name: 'Fireflies',
    category: 'animated',
    type: 'canvas',
    renderer: 'fireflies',
    preview: 'radial-gradient(circle, #0f1a0f, #050a05)'
  }
];

/** @deprecated use WALLPAPER_CATALOG */
export const WALLPAPERS = WALLPAPER_CATALOG;

export function getWallpaperById(id: string): WallpaperDefinition {
  return WALLPAPER_CATALOG.find((w) => w.id === id) ?? WALLPAPER_CATALOG[0];
}

/** Map legacy VisionOS id to webos id */
export function resolveWallpaperId(id: string): string {
  if (id === 'mesh') return 'cosmic-mesh';
  if (WALLPAPER_CATALOG.some((w) => w.id === id)) return id;
  return WALLPAPER_CATALOG[0].id;
}
