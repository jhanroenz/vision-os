import type { RequestHandler } from './$types';
import * as failures from '$lib/server/handlers/failures';

export const GET: RequestHandler = ({ params }) => failures.get(params.id);

export const PATCH: RequestHandler = ({ params, request }) => failures.patch(params.id, request);

export const DELETE: RequestHandler = ({ params }) => failures.remove(params.id);
