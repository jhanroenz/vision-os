export interface TerminalSession {
  id: string;
  cwd: string;
  shell: string;
}

export async function spawnTerminal(cols: number, rows: number): Promise<TerminalSession> {
  const response = await fetch('/api/terminal/spawn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cols, rows })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? `Failed to spawn terminal (${response.status})`);
  }
  return data as TerminalSession;
}

export async function sendTerminalInput(sessionId: string, data: string): Promise<void> {
  await fetch('/api/terminal/input', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, data })
  });
}

export async function resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
  await fetch('/api/terminal/resize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, cols, rows })
  });
}

export function closeTerminal(sessionId: string): void {
  void fetch(`/api/terminal/session?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'DELETE'
  });
}

export function connectTerminalStream(
  sessionId: string,
  handlers: {
    onReady?: (info: { cwd: string; shell: string }) => void;
    onOutput?: (data: string) => void;
    onExit?: (code: number) => void;
    onError?: (message: string) => void;
  }
): EventSource {
  const source = new EventSource(`/api/terminal/stream?sessionId=${encodeURIComponent(sessionId)}`);

  source.onmessage = (event) => {
    if (event.data === '[DONE]') return;
    try {
      const payload = JSON.parse(event.data) as {
        type: string;
        data?: string;
        cwd?: string;
        shell?: string;
        code?: number;
        error?: string;
      };

      if (payload.type === 'ready') {
        handlers.onReady?.({ cwd: payload.cwd ?? '', shell: payload.shell ?? 'bash' });
      } else if (payload.type === 'output' && payload.data != null) {
        handlers.onOutput?.(payload.data);
      } else if (payload.type === 'exit') {
        handlers.onExit?.(payload.code ?? 0);
      } else if (payload.type === 'error') {
        handlers.onError?.(payload.error ?? 'Terminal error');
      }
    } catch {
      handlers.onError?.('Malformed terminal stream');
    }
  };

  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) {
      handlers.onError?.('Terminal connection lost');
    }
  };

  return source;
}
