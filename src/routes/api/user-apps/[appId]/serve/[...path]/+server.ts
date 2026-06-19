import type { RequestHandler } from './$types';
import * as userApps from '$lib/server/handlers/userApps';

export const GET: RequestHandler = ({ params }) =>
  userApps.serve(params.appId, params.path ?? 'index.html');
