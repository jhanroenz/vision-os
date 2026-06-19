import type { RequestHandler } from './$types';
import * as userApps from '$lib/server/handlers/userApps';

export const GET: RequestHandler = ({ params }) => userApps.listJobsHandler(params.appId);

export const POST: RequestHandler = ({ params, request }) =>
  userApps.createJob(params.appId, request);
