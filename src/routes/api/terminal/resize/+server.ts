import type { RequestHandler } from './$types';
import * as terminal from '$lib/server/handlers/terminal';

export const POST: RequestHandler = ({ request }) => terminal.resize(request);
