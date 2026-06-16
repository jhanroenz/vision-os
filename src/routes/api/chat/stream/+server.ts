import type { RequestHandler } from './$types';
import * as chat from '$lib/server/handlers/chat';

export const POST: RequestHandler = ({ request }) => chat.postChatStream(request);
