/** SvelteKit-friendly HTTP helpers for Jarvis API routes. */

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function jsonError(message: string, status = 500, details?: unknown): Response {
  return json(details !== undefined ? { error: message, details } : { error: message }, status);
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

export function sse(
  run: (send: (event: unknown) => void) => Promise<void>,
  options?: { onCleanup?: () => void }
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        await run(send);
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`)
        );
      } finally {
        options?.onCleanup?.();
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  });
}
