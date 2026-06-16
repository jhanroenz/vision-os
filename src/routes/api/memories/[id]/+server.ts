import type { RequestHandler } from './$types';
import * as memories from '$lib/server/handlers/memories';

export const PATCH: RequestHandler = ({ params, request }) => memories.patch(params.id, request);

export const DELETE: RequestHandler = ({ params }) => memories.remove(params.id);
