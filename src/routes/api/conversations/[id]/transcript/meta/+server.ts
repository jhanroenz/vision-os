import type { RequestHandler } from './$types';
import * as conversations from '$lib/server/handlers/conversations';

export const GET: RequestHandler = ({ params }) => conversations.transcriptMeta(params.id);
