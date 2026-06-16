import type { RequestHandler } from './$types';
import * as workspace from '$lib/server/handlers/workspace';

export const POST: RequestHandler = ({ request }) => workspace.postMove(request);
