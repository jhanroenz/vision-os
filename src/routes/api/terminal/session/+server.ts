import type { RequestHandler } from './$types';
import * as terminal from '$lib/server/handlers/terminal';

export const DELETE: RequestHandler = ({ url }) => {
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return terminal.close(sessionId);
};
