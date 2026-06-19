import type { Component } from 'svelte';

export type AppKind = 'builtin' | 'user';
export type UserAppType = 'sandbox' | 'schema' | 'service';

export interface AppDefinition {
  id: string;
  kind?: AppKind;
  name: string;
  icon: string;
  launcher?: boolean;
  defaultWidth?: number;
  defaultHeight?: number;
  component?: Component;
  userType?: UserAppType;
  status?: 'draft' | 'published';
  slug?: string;
}

export interface UserAppRecord {
  id: string;
  slug: string;
  name: string;
  icon: string;
  type: UserAppType;
  status: 'draft' | 'published';
  source: 'workspace' | 'published';
  manifest: Record<string, unknown> | null;
  publishedAt?: number | null;
  updatedAt: number;
  launcher?: boolean;
  defaultWidth?: number;
  defaultHeight?: number;
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
  tiled?: boolean;
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
  wallpaperId: 'jarvis-holo',
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
