import { apiFetch, resolveApiUrl } from './http.js';

export type ResearchTier = 'quick' | 'standard' | 'deep' | 'exhaustive';

export interface ResearchSessionSummary {
  id: string;
  title: string;
  userQuery: string;
  tier: ResearchTier;
  status: string;
  sourceCount?: number;
  searchCount?: number;
  preview?: string;
  createdAt: number;
  completedAt?: number | null;
}

export interface ResearchSessionDetail extends ResearchSessionSummary {
  plan: unknown;
  reportMarkdown: string;
  reportJson: ResearchReport | null;
  error?: string | null;
}

export interface ResearchMediaAsset {
  id: string;
  type: 'image' | 'video';
  url: string;
  embedUrl?: string;
  thumbnailUrl?: string;
  sourcePageUrl?: string;
  title?: string;
  caption?: string;
  provider?: string;
}

export interface ResearchReport {
  media?: ResearchMediaAsset[];
  [key: string]: unknown;
}

export interface ResearchEvent {
  type: string;
  [key: string]: unknown;
}

export async function listResearchSessions(): Promise<ResearchSessionSummary[]> {
  const data = await apiFetch<{ sessions: ResearchSessionSummary[] }>('/api/research');
  return data.sessions ?? [];
}

export async function getResearchSession(id: string): Promise<ResearchSessionDetail> {
  return apiFetch(`/api/research/${encodeURIComponent(id)}`);
}

export async function deleteResearchSession(id: string): Promise<{ ok: true }> {
  return apiFetch(`/api/research/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function updateResearchSessionTitle(id: string, title: string): Promise<{ id: string; title: string }> {
  return apiFetch(`/api/research/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title })
  });
}

export async function streamResearch(
  request: { message: string; tier: ResearchTier },
  handlers: {
    onEvent: (event: ResearchEvent) => void;
    onDone?: () => void;
    onError?: (message: string) => void;
  }
): Promise<void> {
  const response = await fetch(resolveApiUrl('/api/research/stream'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: string }).error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Stream not available');
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk
        .split('\n')
        .find((l) => l.startsWith('data:'))
        ?.slice(5)
        .trim();
      if (!line) continue;
      if (line === '[DONE]') {
        handlers.onDone?.();
        continue;
      }
      try {
        const event = JSON.parse(line) as ResearchEvent;
        if (event.type === 'error') {
          handlers.onError?.(String(event.error ?? 'Stream error'));
          continue;
        }
        handlers.onEvent(event);
      } catch {
        // Ignore malformed stream packets.
      }
    }
  }
}
