import type { RequestHandler } from './$types';
import * as settings from '$lib/server/handlers/settings';

export const POST: RequestHandler = ({ request }) => settings.postSettingsReset(request);
