import {
  listMemories,
  createMemory,
  updateMemory,
  deleteMemory
} from '../coreMemory.js';
import { json, jsonError, readJson } from '../http.js';

export function list(url: URL) {
  try {
    const enabledOnly = url.searchParams.get('enabled') === '1';
    return json({ memories: listMemories({ enabledOnly }) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function create(request: Request) {
  try {
    const { title, content, category, importance, enabled, project } = await readJson(request);
    const memory = await createMemory({
      title,
      content,
      category,
      importance,
      enabled: enabled !== false,
      project,
      source: 'user'
    });
    return json({ memory }, 201);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function patch(id: string, request: Request) {
  try {
    const memory = await updateMemory(id, (await readJson(request)) ?? {});
    return json({ memory });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(message, message === 'Memory not found' ? 404 : 400);
  }
}

export function remove(id: string) {
  try {
    const ok = deleteMemory(id);
    if (!ok) return jsonError('Memory not found', 404);
    return json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}
