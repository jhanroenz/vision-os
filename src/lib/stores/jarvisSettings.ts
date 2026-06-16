import { derived, get, writable } from 'svelte/store';
import {
  fetchSettings,
  resetSection as apiResetSection,
  saveLlmSettings,
  saveSection,
  testLlmConnection,
  type FieldMeta,
  type LlmProviderPreset,
  type LlmSavePayload,
  type LlmSettingsView,
  type LlmTestResult,
  type RateLimitCaps,
  type SettingsView
} from '$lib/api/settings';

export type JarvisSectionId =
  | 'display'
  | 'llm'
  | 'workspace'
  | 'search'
  | 'context'
  | 'agent'
  | 'evolution'
  | 'codeQuality'
  | 'semanticSearch'
  | 'transcripts'
  | 'advanced';

export const JARVIS_NAV_ITEMS: { id: JarvisSectionId; label: string }[] = [
  { id: 'display', label: 'Display' },
  { id: 'llm', label: 'LLM' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'search', label: 'Search' },
  { id: 'context', label: 'Context' },
  { id: 'agent', label: 'Agent' },
  { id: 'evolution', label: 'Evolution' },
  { id: 'codeQuality', label: 'Code quality' },
  { id: 'semanticSearch', label: 'Semantic search' },
  { id: 'transcripts', label: 'Transcripts' },
  { id: 'advanced', label: 'Advanced' }
];

export interface LlmFormState {
  provider: string;
  baseURL: string;
  model: string;
  context: number;
  apiKey: string;
  rateLimitEnabled: boolean;
  rateLimitHeadroom: boolean;
  rateLimitRpm: number | '';
  rateLimitRpd: number | '';
  rateLimitTpm: number | '';
  rateLimitTpd: number | '';
}

interface JarvisSettingsState {
  activeSection: JarvisSectionId;
  loading: boolean;
  saving: boolean;
  testing: boolean;
  error: string | null;
  testResult: LlmTestResult | null;
  providers: LlmProviderPreset[];
  sections: Record<string, Record<string, unknown>>;
  defaults: Record<string, Record<string, unknown>>;
  sectionMeta: Record<string, FieldMeta[]>;
  meta: {
    source: string;
    updatedAt: string | null;
    restartPending: string[];
  };
  form: LlmFormState;
  rateLimitProviders: Record<string, RateLimitCaps>;
  rateLimitModels: Record<string, RateLimitCaps>;
  rateLimitSuggestions: { providers: Record<string, RateLimitCaps>; models: Record<string, RateLimitCaps> };
  rateLimitEffective: RateLimitCaps | null;
  rateLimitLive: { remainingTokens?: number } | null;
  apiKeysSet: Record<string, boolean>;
  source: string;
}

const defaultForm = (): LlmFormState => ({
  provider: 'local',
  baseURL: '',
  model: '',
  context: 8192,
  apiKey: '',
  rateLimitEnabled: true,
  rateLimitHeadroom: true,
  rateLimitRpm: '',
  rateLimitRpd: '',
  rateLimitTpm: '',
  rateLimitTpd: '',
});

const initialState = (): JarvisSettingsState => ({
  activeSection: 'display',
  loading: false,
  saving: false,
  testing: false,
  error: null,
  testResult: null,
  providers: [],
  sections: {},
  defaults: {},
  sectionMeta: {},
  meta: { source: 'defaults', updatedAt: null, restartPending: [] },
  form: defaultForm(),
  rateLimitProviders: {},
  rateLimitModels: {},
  rateLimitSuggestions: { providers: {}, models: {} },
  rateLimitEffective: null,
  rateLimitLive: null,
  apiKeysSet: {},
  source: 'defaults'
});

const internal = writable<JarvisSettingsState>(initialState());

function patch(partial: Partial<JarvisSettingsState>) {
  internal.update((s) => ({ ...s, ...partial }));
}

function normalizeModelId(model: string) {
  return String(model ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.gguf$/i, '');
}

function applySettingsView(data: SettingsView) {
  patch({
    sections: data.sections ?? {},
    defaults: data.defaults ?? {},
    sectionMeta: data.meta?.sections ?? {},
    meta: {
      source: data.meta?.source ?? 'defaults',
      updatedAt: data.meta?.updatedAt ?? null,
      restartPending: data.meta?.restartPending ?? []
    }
  });
  applyLlmView(data.llm);
}

function applyLlmView(llm: LlmSettingsView | undefined) {
  if (!llm) return;
  const state = get(internal);
  patch({
    form: {
      ...state.form,
      provider: llm.provider ?? 'local',
      baseURL: llm.baseURL ?? '',
      model: llm.model ?? '',
      context: Number(llm.context ?? 8192),
      apiKey: '',
      rateLimitEnabled: llm.rateLimit?.enabled !== false,
      rateLimitHeadroom: llm.rateLimit?.headroom !== false,
      rateLimitRpm: '',
      rateLimitRpd: '',
      rateLimitTpm: '',
      rateLimitTpd: ''
    },
    providers: llm.providers ?? [],
    apiKeysSet: llm.apiKeysSet ?? {},
    source: llm.source ?? 'defaults',
    rateLimitProviders: llm.rateLimit?.providers ?? {},
    rateLimitModels: llm.rateLimit?.models ?? {},
    rateLimitSuggestions: llm.rateLimit?.suggestions ?? { providers: {}, models: {} },
    rateLimitEffective: llm.rateLimit?.effective ?? null,
    rateLimitLive: llm.rateLimit?.live ?? null
  });
  jarvisSettings.syncRateLimitForm();
}

function buildLlmSavePayload(): LlmSavePayload {
  const { form } = get(internal);
  const payload: LlmSavePayload = {
    provider: form.provider,
    baseURL: form.baseURL,
    model: form.model,
    context: form.context
  };
  if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();
  if (form.provider !== 'local') {
    payload.rateLimit = {
      enabled: form.rateLimitEnabled,
      headroom: form.rateLimitHeadroom,
      rpm: form.rateLimitRpm === '' ? null : Number(form.rateLimitRpm),
      rpd: form.rateLimitRpd === '' ? null : Number(form.rateLimitRpd),
      tpm: form.rateLimitTpm === '' ? null : Number(form.rateLimitTpm),
      tpd: form.rateLimitTpd === '' ? null : Number(form.rateLimitTpd)
    };
  }
  return payload;
}

export const activeProviderPreset = derived(internal, ($s) =>
  $s.providers.find((p) => p.id === $s.form.provider) ?? null
);

export const apiKeyHint = derived(activeProviderPreset, ($p) => $p?.apiKeyHint ?? null);
export const apiKeyRequired = derived(activeProviderPreset, ($p) => Boolean($p?.apiKeyRequired));
export const currentApiKeySet = derived(internal, ($s) => Boolean($s.apiKeysSet[$s.form.provider]));

export const jarvisSettings = {
  subscribe: internal.subscribe,

  setActiveSection(id: JarvisSectionId) {
    patch({ activeSection: id, error: null, testResult: null });
  },

  updateForm(partial: Partial<LlmFormState>) {
    internal.update((s) => ({ ...s, form: { ...s.form, ...partial } }));
  },

  updateSectionValues(sectionId: string, values: Record<string, unknown>) {
    internal.update((s) => ({
      ...s,
      sections: { ...s.sections, [sectionId]: values }
    }));
  },

  syncApiKeyFieldForProvider() {
    patch({ error: null, testResult: null });
    internal.update((s) => ({ ...s, form: { ...s.form, apiKey: '' } }));
    jarvisSettings.syncRateLimitForm();
  },

  syncRateLimitForm() {
    const s = get(internal);
    if (s.form.provider === 'local') return;
    const modelId = normalizeModelId(s.form.model);
    const modelEntry = modelId ? s.rateLimitModels[modelId] : null;
    const providerEntry = s.rateLimitProviders[s.form.provider];
    const providerSuggestion =
      s.rateLimitSuggestions.providers?.[s.form.provider] ??
      s.rateLimitSuggestions.providers?.custom;
    const modelSuggestion = modelId ? s.rateLimitSuggestions.models?.[modelId] : null;
    const rpm =
      modelEntry?.rpm ?? providerEntry?.rpm ?? modelSuggestion?.rpm ?? providerSuggestion?.rpm ?? null;
    const rpd =
      modelEntry?.rpd ?? providerEntry?.rpd ?? modelSuggestion?.rpd ?? providerSuggestion?.rpd ?? null;
    const tpm =
      modelEntry?.tpm ?? providerEntry?.tpm ?? modelSuggestion?.tpm ?? providerSuggestion?.tpm ?? null;
    const tpd =
      modelEntry?.tpd ?? providerEntry?.tpd ?? modelSuggestion?.tpd ?? providerSuggestion?.tpd ?? null;
    jarvisSettings.updateForm({
      rateLimitRpm: rpm ?? '',
      rateLimitRpd: rpd ?? '',
      rateLimitTpm: tpm ?? '',
      rateLimitTpd: tpd ?? ''
    });
  },

  applyProviderPreset(providerId: string) {
    const s = get(internal);
    const preset = s.providers.find((p) => p.id === providerId);
    if (!preset) return;
    jarvisSettings.updateForm({
      provider: preset.id,
      baseURL: preset.baseURL,
      model: preset.model,
      context: preset.context
    });
    if (s.sections.llm) {
      jarvisSettings.updateSectionValues('llm', {
        ...s.sections.llm,
        provider: preset.id,
        baseURL: preset.baseURL,
        model: preset.model,
        context: preset.context
      });
    }
    jarvisSettings.syncApiKeyFieldForProvider();
  },

  onModelInput() {
    jarvisSettings.syncRateLimitForm();
  },

  onBaseUrlInput() {
    const s = get(internal);
    const url = s.form.baseURL.toLowerCase();
    const previous = s.form.provider;
    let provider = s.form.provider;
    if (url.includes('generativelanguage.googleapis.com')) provider = 'gemini';
    else if (url.includes('api.groq.com')) provider = 'groq';
    else if (url.includes('openrouter.ai')) provider = 'openrouter';
    else if (url.includes('api.cerebras.ai')) provider = 'cerebras';
    else if (url.includes('api.openai.com')) provider = 'openai';
    else if (/localhost|127\.0\.0\.1/.test(url)) provider = 'local';
    else if (url.trim()) provider = 'custom';
    if (provider !== previous) {
      jarvisSettings.updateForm({ provider });
      jarvisSettings.syncApiKeyFieldForProvider();
    }
  },

  async load() {
    patch({ loading: true, error: null });
    try {
      const data = await fetchSettings();
      applySettingsView(data);
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      patch({ loading: false });
    }
  },

  async save() {
    const s = get(internal);
    if (s.activeSection === 'display') return;
    if (s.activeSection === 'llm') return jarvisSettings.saveLlm();
    patch({ saving: true, error: null });
    try {
      const data = await saveSection(s.activeSection, s.sections[s.activeSection] ?? {});
      applySettingsView(data);
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      patch({ saving: false });
    }
  },

  async saveLlm() {
    patch({ saving: true, error: null });
    try {
      const data = await saveLlmSettings(buildLlmSavePayload());
      const s = get(internal);
      const extra = s.sections.llm ?? {};
      const extraKeys = [
        'temperature',
        'slotsEnabled',
        'slotId',
        'streaming',
        'rateLimitMaxRetries',
        'rateLimitBaseBackoffMs',
        'rateLimitMaxBackoffMs'
      ];
      const extraPatch: Record<string, unknown> = {};
      for (const k of extraKeys) {
        if (extra[k] !== undefined) extraPatch[k] = extra[k];
      }
      if (Object.keys(extraPatch).length) {
        const data2 = await saveSection('llm', extraPatch);
        applySettingsView(data2);
      }
      applyLlmView(data);
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      patch({ saving: false });
    }
  },

  async resetSection(section?: JarvisSectionId) {
    if (section === 'display') return;
    const target = section ?? get(internal).activeSection;
    if (target === 'display') return;
    patch({ saving: true, error: null });
    try {
      const data = await apiResetSection(target);
      applySettingsView(data);
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      patch({ saving: false });
    }
  },

  async testConnection() {
    patch({ testing: true, error: null, testResult: null });
    try {
      const data = await testLlmConnection(buildLlmSavePayload());
      patch({ testResult: data });
      if (data.rateLimitLive) patch({ rateLimitLive: data.rateLimitLive });
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      patch({ testing: false });
    }
  }
};

export const SECTION_HINTS: Partial<Record<JarvisSectionId, string>> = {
  workspace: 'Directory the agent can read and write. Restart required after changing workspace path.',
  search: 'SearXNG and web search behavior.',
  context: 'Context window management and tool result minification.',
  agent: 'Agent loop, planners, and tool parallelism.',
  evolution: 'Core memory, skills, and brain recall.',
  codeQuality: 'Syntax checking and AST read gates.',
  semanticSearch: 'Codebase semantic search (restart required when changing model).',
  transcripts: 'Debug transcript logging.',
  advanced: 'Less common tuning options.'
};
