import {
  spawnTerminal,
  getTerminalSession,
  writeTerminalInput,
  resizeTerminal,
  closeTerminal
} from '../terminalPty.js';
import { json, jsonError, readJson } from '../http.js';

export async function spawn(request: Request) {
  try {
    const body = await readJson<{ cols?: number; rows?: number }>(request).catch(() => ({}));
    const session = spawnTerminal({
      cols: body.cols ?? 80,
      rows: body.rows ?? 24
    });
    return json(session, 201);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 500);
  }
}

export function stream(sessionId: string, request: Request) {
  const session = getTerminalSession(sessionId);
  if (!session) {
    return jsonError('Terminal session not found', 404);
  }

  const encoder = new TextEncoder();

  const streamBody = new ReadableStream({
    start(controller) {
      let finished = false;
      let unsubscribe: (() => void) | undefined;

      const finish = () => {
        if (finished) return;
        finished = true;
        unsubscribe?.();
        request.signal.removeEventListener('abort', onAbort);
        try {
          controller.close();
        } catch {
          // Stream already closed (client disconnect + PTY exit race).
        }
      };

      const send = (event: unknown) => {
        if (finished) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          finish();
        }
      };

      send({ type: 'ready', cwd: session.cwd, shell: session.shell });

      unsubscribe = session.subscribe((data, meta) => {
        if (meta?.exitCode != null) {
          send({ type: 'exit', code: meta.exitCode });
          finish();
          return;
        }
        if (data) send({ type: 'output', data });
      });

      const onAbort = () => finish();

      request.signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  return new Response(streamBody, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  });
}

export async function input(request: Request) {
  try {
    const { sessionId, data } = await readJson<{ sessionId?: string; data?: string }>(request);
    if (!sessionId) return jsonError('sessionId is required', 400);
    if (data == null) return jsonError('data is required', 400);
    if (!writeTerminalInput(sessionId, data)) {
      return jsonError('Terminal session not found or closed', 404);
    }
    return json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function resize(request: Request) {
  try {
    const { sessionId, cols, rows } = await readJson<{
      sessionId?: string;
      cols?: number;
      rows?: number;
    }>(request);
    if (!sessionId) return jsonError('sessionId is required', 400);
    if (!cols || !rows) return jsonError('cols and rows are required', 400);
    if (!resizeTerminal(sessionId, cols, rows)) {
      return jsonError('Terminal session not found', 404);
    }
    return json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export function close(sessionId: string) {
  if (!closeTerminal(sessionId)) {
    return jsonError('Terminal session not found', 404);
  }
  return json({ ok: true });
}
