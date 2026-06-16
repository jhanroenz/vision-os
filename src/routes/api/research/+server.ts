import type { RequestHandler } from './$types';
import * as research from '$lib/server/handlers/research';

export const GET: RequestHandler = () => research.list();
