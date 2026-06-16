import type { RequestHandler } from './$types';
import * as conversations from '$lib/server/handlers/conversations';

export const GET: RequestHandler = ({ params }) => conversations.get(params.id);

export const PATCH: RequestHandler = ({ params, request }) =>
  conversations.patch(params.id, request);

export const DELETE: RequestHandler = ({ params }) => conversations.remove(params.id);
