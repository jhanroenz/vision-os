import type { RequestHandler } from './$types';
import * as skills from '$lib/server/handlers/skills';

export const GET: RequestHandler = ({ url }) => skills.list(url);

export const POST: RequestHandler = ({ request }) => skills.create(request);
