import type { RequestHandler } from './$types';
import * as shell from '$lib/server/handlers/shell';

export const POST: RequestHandler = ({ params }) => shell.cancel(params.threadId);
