import { listSkills, createSkill, updateSkill, deleteSkill } from '../skills.js';
import { json, jsonError, readJson } from '../http.js';

export function list(url: URL) {
  try {
    const enabledOnly = url.searchParams.get('enabled') === '1';
    return json({ skills: listSkills({ enabledOnly }) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function create(request: Request) {
  try {
    const { name, description, instructions, enabled, project } = await readJson(request);
    const skill = await createSkill({
      name,
      description,
      instructions,
      enabled: enabled !== false,
      project,
      source: 'user'
    });
    return json({ skill }, 201);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function patch(id: string, request: Request) {
  try {
    const skill = await updateSkill(id, (await readJson(request)) ?? {});
    return json({ skill });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(message, message === 'Skill not found' ? 404 : 400);
  }
}

export function remove(id: string) {
  try {
    const ok = deleteSkill(id);
    if (!ok) return jsonError('Skill not found', 404);
    return json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}
