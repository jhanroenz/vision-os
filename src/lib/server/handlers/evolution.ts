import { reflectConversation } from '../evolution.js';
import { recompressAllMemories } from '../coreMemory.js';
import { recompressAllSkills } from '../skills.js';
import { json, jsonError, readJson } from '../http.js';

export async function reflect(request: Request) {
  try {
    const { conversationId } = await readJson(request);
    if (!conversationId) {
      return jsonError('conversationId is required', 400);
    }
    const result = await reflectConversation(conversationId);
    return json(result);
  } catch (error) {
    console.error('Reflect error:', error);
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function recompress() {
  try {
    const result = {
      ok: true,
      memories: 0,
      skills: 0,
      errors: [] as string[]
    };

    try {
      const memories = await recompressAllMemories();
      result.memories = memories.updated;
    } catch (error) {
      result.ok = false;
      result.errors.push(`memory: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const skills = await recompressAllSkills();
      result.skills = skills.updated;
    } catch (error) {
      result.ok = false;
      result.errors.push(`skill: ${error instanceof Error ? error.message : String(error)}`);
    }

    return json(result);
  } catch (error) {
    console.error('Recompress error:', error);
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}
