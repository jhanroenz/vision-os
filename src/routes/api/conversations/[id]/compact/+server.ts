import type { RequestHandler } from './$types';
import * as conversations from '$lib/server/handlers/conversations';

export const POST: RequestHandler = ({ params }) => conversations.compact(params.id);
