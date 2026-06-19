import type { RequestHandler } from './$types';
import * as userApps from '$lib/server/handlers/userApps';

export const GET: RequestHandler = () => userApps.list();

export const POST: RequestHandler = () => userApps.scan();
