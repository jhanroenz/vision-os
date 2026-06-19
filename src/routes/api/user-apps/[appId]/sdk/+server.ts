import type { RequestHandler } from './$types';
import * as userApps from '$lib/server/handlers/userApps';

export const POST: RequestHandler = ({ params, request }) => userApps.sdk(params.appId, request);
