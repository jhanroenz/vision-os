import type { RequestHandler } from './$types';
import * as settings from '$lib/server/handlers/settings';

export const POST: RequestHandler = ({ params, request }) =>
  settings.postLlmPreset(params.providerId, request);
