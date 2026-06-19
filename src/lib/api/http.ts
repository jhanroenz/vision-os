import { PACKAGED_BACKEND_ORIGIN, PACKAGED_BACKEND_PORT } from '$lib/config/packaged';
import { isTauriShell } from '$lib/platform/browser';

function onBundledBackendOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.protocol === 'http:' &&
    window.location.hostname === '127.0.0.1' &&
    window.location.port === String(PACKAGED_BACKEND_PORT)
  );
}

/** Resolve relative API paths for Tauri packaged shells (asset or localhost webview). */
export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;

  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (typeof window === 'undefined') return normalized;
  if (onBundledBackendOrigin()) return normalized;
  if (isTauriShell()) {
    // tauri dev loads Vite/SvelteKit on :5173 — API is same-origin, not the packaged Node port.
    if (import.meta.env.DEV) return normalized;
    return `${PACKAGED_BACKEND_ORIGIN}${normalized}`;
  }
  return normalized;
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(resolveApiUrl(url), init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: string }).error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}
