import type { RequestHandler } from './$types';
import * as settings from '$lib/server/handlers/settings';

export const GET: RequestHandler = () => settings.getLlmSettings();

export const PUT: RequestHandler = ({ request }) => settings.putLlmSettings(request);
