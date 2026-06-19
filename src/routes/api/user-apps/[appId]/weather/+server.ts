import type { RequestHandler } from './$types';
import * as userApps from '$lib/server/handlers/userApps';

export const GET: RequestHandler = ({ params, url }) =>
  userApps.weatherFetch(params.appId, url.searchParams.get('url'));
