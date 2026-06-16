async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
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

export async function cancelShell(threadId: string): Promise<boolean> {
  const result = await api<{ cancelled?: boolean }>(`/api/shell/${threadId}/cancel`, { method: 'POST' });
  return Boolean(result.cancelled);
}
