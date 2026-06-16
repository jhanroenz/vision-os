import type { RequestHandler } from './$types';
import * as research from '$lib/server/handlers/research';

export const POST: RequestHandler = ({ request }) => research.stream(request);
