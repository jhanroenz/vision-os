import { listFailures, getFailure, patchFailure, deleteFailure } from '../failureMemory.js';
import { json, jsonError, readJson } from '../http.js';

export function list(url: URL) {
  try {
    const enabledOnly = url.searchParams.get('enabled') === '1';
    const status = url.searchParams.get('status') ?? 'active';
    return json({ failures: listFailures({ enabledOnly, status }) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export function get(id: string) {
  try {
    const failure = getFailure(id);
    if (!failure) return jsonError('Failure lesson not found', 404);
    return json({ failure });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function patch(id: string, request: Request) {
  try {
    const failure = patchFailure(id, (await readJson(request)) ?? {});
    return json({ failure });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(message, message === 'Failure memory not found' ? 404 : 400);
  }
}

export function remove(id: string) {
  try {
    deleteFailure(id);
    return json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}
