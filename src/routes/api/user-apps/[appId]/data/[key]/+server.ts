import type { RequestHandler } from './$types';
import * as userApps from '$lib/server/handlers/userApps';

export const GET: RequestHandler = ({ params }) => userApps.getData(params.appId, params.key);

export const PUT: RequestHandler = ({ params, request }) =>
  userApps.putData(params.appId, params.key, request);

export const DELETE: RequestHandler = ({ params }) =>
  userApps.deleteData(params.appId, params.key);
