import type { RequestHandler } from './$types';
import * as skills from '$lib/server/handlers/skills';

export const PATCH: RequestHandler = ({ params, request }) => skills.patch(params.id, request);

export const DELETE: RequestHandler = ({ params }) => skills.remove(params.id);
