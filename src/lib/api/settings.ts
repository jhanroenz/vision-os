import { apiFetch } from './http.js';

/** Client for Jarvis settings API (/api/settings). */

export interface FieldMeta {
  key: string;
  label: string;
  description?: string;
  type: string;
  default?: unknown;
  min?: number;
  max?: number;
  options?: string[];
  restartRequired?: boolean;
}

export interface SettingsMeta {
  source: string;
  updatedAt: string | null;
  restartPending: string[];
  sections: Record<string, FieldMeta[]>;
}

export interface LlmProviderPreset {
  id: string;
  label: string;
  baseURL: string;
  model: string;
  context: number;
  apiKeyHint?: string;
  apiKeyRequired?: boolean;
}

export interface RateLimitCaps {
  rpm?: number | null;
  rpd?: number | null;
  tpm?: number | null;
  tpd?: number | null;
}

export interface LlmSettingsView {
  provider: string;
  baseURL: string;
  model: string;
  context: number;
  apiKeySet?: boolean;
  apiKeysSet?: Record<string, boolean>;
  providers?: LlmProviderPreset[];
  source?: string;
  rateLimit?: {
    enabled?: boolean;
    headroom?: boolean;
    providers?: Record<string, RateLimitCaps>;
    models?: Record<string, RateLimitCaps>;
    suggestions?: { providers?: Record<string, RateLimitCaps>; models?: Record<string, RateLimitCaps> };
    effective?: RateLimitCaps | null;
    live?: { remainingTokens?: number } | null;
  };
}

export interface SettingsView {
  sections: Record<string, Record<string, unknown>>;
  defaults: Record<string, Record<string, unknown>>;
  meta: SettingsMeta;
  llm: LlmSettingsView;
}

export interface LlmSavePayload {
  provider: string;
  baseURL: string;
  model: string;
  context: number;
  apiKey?: string;
  rateLimit?: {
    enabled: boolean;
    headroom: boolean;
    rpm: number | null;
    rpd: number | null;
    tpm: number | null;
    tpd: number | null;
  };
}

export interface LlmTestResult {
  ok: boolean;
  provider?: string;
  model?: string;
  modelsFound?: number;
  error?: string;
  rateLimitLive?: { remainingTokens?: number };
}

export async function fetchSettings(): Promise<SettingsView> {
  return apiFetch('/api/settings');
}

export async function saveSection(
  section: string,
  values: Record<string, unknown>
): Promise<SettingsView> {
  return apiFetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, values })
  });
}

export async function saveSections(
  sections: Record<string, Record<string, unknown>>
): Promise<SettingsView> {
  return apiFetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sections })
  });
}

export async function resetSection(section?: string): Promise<SettingsView> {
  return apiFetch('/api/settings/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(section ? { section } : {})
  });
}

export async function saveLlmSettings(body: LlmSavePayload): Promise<LlmSettingsView> {
  return apiFetch('/api/settings/llm', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export async function testLlmConnection(body?: LlmSavePayload): Promise<LlmTestResult> {
  return apiFetch('/api/settings/llm/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {})
  });
}

export async function applyLlmPreset(
  providerId: string,
  apiKey?: string
): Promise<LlmSettingsView> {
  return apiFetch(`/api/settings/llm/preset/${encodeURIComponent(providerId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(apiKey ? { apiKey } : {})
  });
}

export async function resetLlmSettings(): Promise<SettingsView> {
  return apiFetch('/api/settings/llm/reset', { method: 'POST' });
}
