import type { AppDefinition, UserAppRecord } from '$lib/types';
import { apiFetch } from './http.js';

export async function listUserApps(): Promise<UserAppRecord[]> {
  const data = await apiFetch<{ apps: UserAppRecord[] }>('/api/user-apps');
  return data.apps ?? [];
}

export async function syncUserApps(): Promise<{ workspace: UserAppRecord[]; published: UserAppRecord[] }> {
  return apiFetch('/api/user-apps', { method: 'POST' });
}

export async function getUserApp(appId: string): Promise<UserAppRecord> {
  return apiFetch(`/api/user-apps/${encodeURIComponent(appId)}`);
}

export async function publishUserApp(appId: string): Promise<{ app: UserAppRecord }> {
  return apiFetch(`/api/user-apps/${encodeURIComponent(appId)}/publish`, { method: 'POST' });
}

export async function deleteUserApp(appId: string): Promise<{ ok: true }> {
  return apiFetch(`/api/user-apps/${encodeURIComponent(appId)}`, { method: 'DELETE' });
}

export async function getAppData(appId: string, key: string): Promise<{ key: string; value: unknown }> {
  return apiFetch(`/api/user-apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(key)}`);
}

export async function setAppDataApi(
  appId: string,
  key: string,
  value: unknown
): Promise<{ key: string; value: unknown }> {
  return apiFetch(`/api/user-apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value })
  });
}

export async function callUserAppSdk(
  appId: string,
  method: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const data = await apiFetch<{ result: unknown }>(
    `/api/user-apps/${encodeURIComponent(appId)}/sdk`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args })
    }
  );
  return data.result;
}

export async function submitSchemaAction(
  appId: string,
  action: string,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  return apiFetch(`/api/user-apps/${encodeURIComponent(appId)}/schema-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload })
  });
}

export function userAppServeUrl(slug: string, entry = 'index.html'): string {
  return `/api/user-apps/${encodeURIComponent(slug)}/serve/${entry}`;
}

export function userAppToDefinition(app: UserAppRecord): AppDefinition {
  const manifest = app.manifest as {
    defaultWidth?: number;
    defaultHeight?: number;
  } | null;
  return {
    id: app.id,
    kind: 'user',
    slug: app.slug,
    name: app.name,
    icon: app.icon,
    launcher: app.launcher !== false && app.status === 'published',
    defaultWidth: app.defaultWidth ?? manifest?.defaultWidth ?? 640,
    defaultHeight: app.defaultHeight ?? manifest?.defaultHeight ?? 480,
    userType: app.type,
    status: app.status
  };
}
