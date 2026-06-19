import type { RequestHandler } from './$types';
import * as userApps from '$lib/server/handlers/userApps';

export const GET: RequestHandler = ({ params }) =>
  userApps.getJobHandler(params.appId, params.jobId);

export const PATCH: RequestHandler = ({ params, request }) =>
  userApps.patchJob(params.appId, params.jobId, request);

export const DELETE: RequestHandler = ({ params }) =>
  userApps.removeJob(params.appId, params.jobId);
