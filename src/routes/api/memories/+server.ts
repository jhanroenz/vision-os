import type { RequestHandler } from './$types';
import * as memories from '$lib/server/handlers/memories';

export const GET: RequestHandler = ({ url }) => memories.list(url);

export const POST: RequestHandler = ({ request }) => memories.create(request);
