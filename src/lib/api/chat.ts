import { apiFetch, resolveApiUrl } from './http.js';

export interface ChatRequest {
  message: string;
  threadId: string;
  mode?: string;
}

export interface ChatEvent {
  type: string;
  [key: string]: unknown;
}

export async function postChat(request: ChatRequest): Promise<Record<string, unknown>> {
  return apiFetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });
}

export async function streamChat(
  request: ChatRequest,
  handlers: {
    onEvent: (event: ChatEvent) => void;
    onDone?: () => void;
    onError?: (message: string) => void;
  }
): Promise<void> {
  const response = await fetch(resolveApiUrl('/api/chat/stream'), {
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
  if (!reader) {
    throw new Error('Stream not available');
  }
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
        const event = JSON.parse(line) as ChatEvent;
        if (event.type === 'error') {
          handlers.onError?.(String(event.error ?? 'Stream error'));
          continue;
        }
        handlers.onEvent(event);
      } catch {
        // Ignore malformed events.
      }
    }
  }
}
