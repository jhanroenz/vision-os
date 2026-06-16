import type { RequestHandler } from './$types';
import * as shell from '$lib/server/handlers/shell';

export const GET: RequestHandler = ({ params }) => shell.status(params.threadId);
