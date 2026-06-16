import type { RequestHandler } from './$types';
import * as conversations from '$lib/server/handlers/conversations';

export const GET: RequestHandler = () => conversations.list();

export const POST: RequestHandler = () => conversations.create();
