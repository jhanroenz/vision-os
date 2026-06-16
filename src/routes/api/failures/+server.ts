import type { RequestHandler } from './$types';
import * as failures from '$lib/server/handlers/failures';

export const GET: RequestHandler = ({ url }) => failures.list(url);
