import type { RequestHandler } from './$types';
import * as settings from '$lib/server/handlers/settings';

export const GET: RequestHandler = () => settings.getSettings();

export const PUT: RequestHandler = ({ request }) => settings.putSettings(request);
