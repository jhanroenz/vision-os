import type { RequestHandler } from './$types';
import * as research from '$lib/server/handlers/research';

export const GET: RequestHandler = ({ params }) => research.get(params.sessionId);

export const PATCH: RequestHandler = ({ params, request }) =>
  research.patch(params.sessionId, request);

export const DELETE: RequestHandler = ({ params }) => research.remove(params.sessionId);
