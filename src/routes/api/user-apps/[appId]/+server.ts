import type { RequestHandler } from './$types';
import * as userApps from '$lib/server/handlers/userApps';

export const GET: RequestHandler = ({ params }) => userApps.get(params.appId);

export const DELETE: RequestHandler = ({ params }) => userApps.remove(params.appId);
