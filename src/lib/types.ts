import type { Component } from 'svelte';

export interface AppDefinition {
  id: string;
  name: string;
  icon: string;
  defaultWidth?: number;
  defaultHeight?: number;
  component: Component;
}

export interface WindowState {
  id: string;
  appId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  prevBounds?: { x: number; y: number; width: number; height: number };
  props?: Record<string, unknown>;
}

export interface OsSettings {
  accent: string;
  username: string;
  wallpaperId: string;
  wallpaperSpeed: number;
  wallpaperDim: number;
}

export const DEFAULT_SETTINGS: OsSettings = {
  accent: '#6c5ce7',
  username: 'Operator',
  wallpaperId: 'ocean-dusk',
  wallpaperSpeed: 1,
  wallpaperDim: 0.15
};

export {
  WALLPAPER_CATALOG,
  WALLPAPERS,
  getWallpaperById,
  resolveWallpaperId
} from '$lib/wallpapers/catalog';

export type { WallpaperDefinition, WallpaperCategory } from '$lib/wallpapers/catalog';
