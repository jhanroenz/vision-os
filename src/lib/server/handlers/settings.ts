import {
  getLlmSettingsView,
  getSettingsView,
  updateLlmSettings,
  updateSettings,
  applyLlmProviderPreset,
  resetLlmSettings,
  resetSettings,
  testLlmConnection
} from '../settings.js';
import { json, jsonError, readJson } from '../http.js';

export function getLlmSettings() {
  try {
    return json(getLlmSettingsView());
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export function getSettings() {
  try {
    return json(getSettingsView());
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function putSettings(request: Request) {
  try {
    const body = await readJson(request);
    const { section, values, sections } = body ?? {};
    const updated = await updateSettings({ section, values, sections });
    return json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const details = error && typeof error === 'object' && 'details' in error ? error.details : undefined;
    return jsonError(message, 400, details);
  }
}

export async function postSettingsReset(request: Request) {
  try {
    const body = await readJson(request);
    const { section } = body ?? {};
    const updated = await resetSettings({ section });
    return json(updated);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function putLlmSettings(request: Request) {
  try {
    const { provider, baseURL, model, context, apiKey, rateLimit } = await readJson(request);
    const updated = await updateLlmSettings({
      provider,
      baseURL,
      model,
      context,
      apiKey,
      rateLimit
    });
    return json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const details = error && typeof error === 'object' && 'details' in error ? error.details : undefined;
    return jsonError(message, 400, details);
  }
}

export async function postLlmPreset(providerId: string, request: Request) {
  try {
    const { apiKey } = await readJson(request);
    const updated = await applyLlmProviderPreset(providerId, { apiKey });
    return json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const details = error && typeof error === 'object' && 'details' in error ? error.details : undefined;
    return jsonError(message, 400, details);
  }
}

export async function postLlmReset() {
  try {
    const updated = await resetLlmSettings();
    return json(updated);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function postLlmTest(request: Request) {
  try {
    const { provider, baseURL, model, context, apiKey } = await readJson(request);
    const overrides =
      provider !== undefined ||
      baseURL !== undefined ||
      model !== undefined ||
      context !== undefined ||
      apiKey !== undefined
        ? { provider, baseURL, model, context, apiKey }
        : {};
    const result = await testLlmConnection(overrides);
    return json(result);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 502);
  }
}
