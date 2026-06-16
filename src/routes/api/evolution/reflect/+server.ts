import type { RequestHandler } from './$types';
import * as evolution from '$lib/server/handlers/evolution';

export const POST: RequestHandler = ({ request }) => evolution.reflect(request);
