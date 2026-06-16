import type { RequestHandler } from './$types';
import * as workspace from '$lib/server/handlers/workspace';

export const DELETE: RequestHandler = ({ url }) => workspace.deleteEntry(url);
