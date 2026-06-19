import type { RequestHandler } from './$types';
import * as userApps from '$lib/server/handlers/userApps';

export const POST: RequestHandler = ({ params, request }) =>
  userApps.schemaAction(params.appId, request);
