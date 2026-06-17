import { apiFetch } from './http.js';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  return apiFetch<T>(url, init);
}

export async function cancelShell(threadId: string): Promise<boolean> {
  const result = await api<{ cancelled?: boolean }>(`/api/shell/${threadId}/cancel`, { method: 'POST' });
  return Boolean(result.cancelled);
}
