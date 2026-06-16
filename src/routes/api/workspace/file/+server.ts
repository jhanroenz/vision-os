import type { RequestHandler } from './$types';
import * as workspace from '$lib/server/handlers/workspace';

export const GET: RequestHandler = ({ url }) => workspace.file(url);

export const PUT: RequestHandler = ({ request }) => workspace.putFile(request);
