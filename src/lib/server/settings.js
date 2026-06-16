import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  loadAppSettings,
  saveAppSettings,
  seedAppSettingsIfEmpty,
  deleteAppSettings,
} from "./appSettingsDb.js";
import {
  SETTING_SECTIONS,
  getCodeDefaultsBySection,
  extractAllSectionsFromConfig,
  extractSectionFromConfig,
  applySectionToConfig,
  validateSectionPatch,
  applySettingsOverlay,
  mergeSectionPayload,
  getRestartRequiredSections,
  getSectionMeta,
} from "./settingsRegistry.js";
import {
  normalizeLlmBaseUrl,
  detectProviderFromBaseUrl,
  listProviderPresets,
  resolveLlmApiKey,
  resolveEnvApiKey,
  ensureProviderApiKey,
  hydrateLlmApiKeyFromEnv,
  isAcceptedProviderApiKey,
  applyProviderDefaults,
  providerRequiresApiKey,
  sanitizeApiKey,
  getActiveProviderId,
} from "./llmProviders.js";
import {
  normalizeModelId,
  resolveLlmRateLimits,
  getRateLimitFormValues,
  getRateLimitSuggestions,
  getRateLimitLiveState,
  ingestGroqRateLimitHeaders,
} from "./llmRateLimit.js";

const LLM_SETTING_KEYS = ["provider", "baseURL", "model", "context", "apiKey"];

function willHaveApiKey(provider, patch) {
  if (sanitizeApiKey(patch.apiKey)) {
    return isAcceptedProviderApiKey(provider, patch.apiKey);
  }
  if (resolveEnvApiKey(provider)) return true;
  const stored = sanitizeApiKey(config.llm.apiKeys?.[provider]);
  if (stored && isAcceptedProviderApiKey(provider, stored)) return true;
  return false;
}

function settingsFilePath() {
  return path.join(path.dirname(config.dbPath), "settings.json");
}

let persistedPayload = null;
let restartPendingSections = [];

async function migrateLegacySettingsFile() {
  const filePath = settingsFilePath();
  let file;
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    file = JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  const current = loadAppSettings()?.payload ?? getCodeDefaultsBySection();
  if (file?.llm && typeof file.llm === "object") {
    const llm = { ...(current.llm ?? {}) };
    for (const key of ["provider", "baseURL", "model", "context"]) {
      if (file.llm[key] != null) llm[key] = file.llm[key];
    }
    if (file.llm.rateLimit) {
      llm.rateLimitEnabled = file.llm.rateLimit.enabled !== false;
      llm.rateLimitHeadroom = file.llm.rateLimit.headroom !== false;
    }
    current.llm = llm;
    if (file.llm.apiKeys) current._apiKeys = file.llm.apiKeys;
    if (file.llm.rateLimit) {
      current._rateLimitProviders = file.llm.rateLimit.providers ?? {};
      current._rateLimitModels = file.llm.rateLimit.models ?? {};
    }
    saveAppSettings(stripInternalPayload(current));
  }

  try {
    await fs.rename(filePath, `${filePath}.migrated`);
    console.log("[settings] Migrated settings.json → database");
  } catch {
    // ignore
  }
  return current;
}

function stripInternalPayload(payload) {
  const out = structuredClone(payload);
  delete out._apiKeys;
  delete out._rateLimitProviders;
  delete out._rateLimitModels;
  return out;
}

function attachInternalPayload(payload, { apiKeys, rateLimitProviders, rateLimitModels } = {}) {
  const out = structuredClone(payload);
  if (apiKeys) out._apiKeys = apiKeys;
  if (rateLimitProviders) out._rateLimitProviders = rateLimitProviders;
  if (rateLimitModels) out._rateLimitModels = rateLimitModels;
  return out;
}

async function persistSettingsPayload(payload) {
  const stored = attachInternalPayload(stripInternalPayload(payload), {
    apiKeys: config.llm.apiKeys,
    rateLimitProviders: config.llm.rateLimit?.providers ?? {},
    rateLimitModels: config.llm.rateLimit?.models ?? {},
  });
  const prev = persistedPayload;
  restartPendingSections = getRestartRequiredSections(stored, prev);
  persistedPayload = stored;
  return saveAppSettings(stored);
}

function applyInternalPayloadExtras(payload) {
  if (payload?._apiKeys) {
    config.llm.apiKeys = normalizeApiKeys(payload._apiKeys);
  }
  if (payload?._rateLimitProviders || payload?._rateLimitModels) {
    loadRateLimitFromPersisted({
      rateLimit: {
        providers: payload._rateLimitProviders ?? {},
        models: payload._rateLimitModels ?? {},
      },
    });
  }
}

function applyLlmSectionFromPayload(llm) {
  if (!llm || typeof llm !== "object") return;
  applySettingsOverlay(config, { llm });
  const patch = {};
  for (const key of LLM_SETTING_KEYS) {
    if (llm[key] !== undefined && llm[key] !== "") patch[key] = llm[key];
  }
  if (Object.keys(patch).length) {
    try {
      const validated = validateLlmSettings(patch, { requireApiKey: false });
      applyLlmSettings(validated);
      activateProviderApiKey(getActiveProviderId(), validated.apiKey);
    } catch (error) {
      console.warn("[settings] Invalid LLM section:", error.message);
    }
  }
}

function bootstrapApiKeysFromEnv() {
  const providers = [
    "openai",
    "gemini",
    "groq",
    "openrouter",
    "cerebras",
    "cursor",
    "custom",
  ];
  for (const id of providers) {
    if (config.llm.apiKeys?.[id]) continue;
    const envKey = resolveEnvApiKey(id);
    if (envKey && isAcceptedProviderApiKey(id, envKey)) {
      rememberProviderApiKey(id, envKey);
    }
  }
  activateProviderApiKey(getActiveProviderId());
}

function normalizeApiKeys(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [provider, key] of Object.entries(raw)) {
    const clean = sanitizeApiKey(key);
    if (clean && isAcceptedProviderApiKey(provider, clean)) {
      out[String(provider)] = clean;
    }
  }
  return out;
}

function loadApiKeysFromLlm(llm) {
  if (!llm || typeof llm !== "object") return {};
  if (llm.apiKeys && typeof llm.apiKeys === "object") {
    return normalizeApiKeys(llm.apiKeys);
  }
  if (llm.apiKey && llm.provider) {
    return { [String(llm.provider)]: sanitizeApiKey(llm.apiKey) };
  }
  return {};
}

function activateProviderApiKey(provider, explicitKey) {
  if (explicitKey !== undefined) {
    const clean = sanitizeApiKey(explicitKey);
    if (clean && isAcceptedProviderApiKey(provider, clean)) {
      config.llm.apiKey = clean;
      return;
    }
  }
  ensureProviderApiKey(provider);
}

function rememberProviderApiKey(provider, key) {
  const clean = sanitizeApiKey(key);
  if (!clean || !providerRequiresApiKey(provider)) return;
  if (!isAcceptedProviderApiKey(provider, clean)) return;
  config.llm.apiKeys[provider] = clean;
}

function providerHasStoredApiKey(providerId) {
  if (!providerRequiresApiKey(providerId)) return false;
  const stored = sanitizeApiKey(config.llm.apiKeys?.[providerId]);
  if (stored && isAcceptedProviderApiKey(providerId, stored)) return true;
  return Boolean(resolveEnvApiKey(providerId));
}

function buildApiKeysSetView() {
  const ids = [
    "openai",
    "gemini",
    "groq",
    "openrouter",
    "cerebras",
    "cursor",
    "custom",
  ];
  const out = {};
  for (const id of ids) {
    out[id] = providerHasStoredApiKey(id);
  }
  return out;
}

export function getEnvLlmDefaults() {
  const provider =
    process.env.LLM_PROVIDER ??
    (process.env.OPENROUTER_API_KEY
      ? "openrouter"
      : process.env.CEREBRAS_API_KEY
        ? "cerebras"
        : process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
          ? "gemini"
          : "local");

  const preset = applyProviderDefaults(provider);
  return {
    provider: preset?.provider ?? "local",
    baseURL:
      process.env.LLM_BASE_URL ??
      preset?.baseURL ??
      "http://localhost:11434/v1",
    model:
      process.env.LLM_MODEL ??
      preset?.model ??
      "gemma-4-E2B-it-Q4_K_M.gguf",
    context: Number(
      process.env.LLM_CONTEXT ?? preset?.context ?? 131072,
    ),
    apiKeySet: Boolean(
      process.env.LLM_API_KEY ||
        process.env.GROQ_API_KEY ||
        process.env.OPENROUTER_API_KEY ||
        process.env.CEREBRAS_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.OPENAI_API_KEY,
    ),
  };
}

export { normalizeLlmBaseUrl };

export function validateLlmSettings(input = {}, { requireApiKey = true } = {}) {
  const errors = [];
  const result = {};

  const providerHint =
    input.provider !== undefined
      ? String(input.provider)
      : input.baseURL !== undefined
        ? detectProviderFromBaseUrl(input.baseURL)
        : undefined;

  if (input.provider !== undefined) {
    const provider = String(input.provider);
    if (
      ![
        "local",
        "openai",
        "gemini",
        "groq",
        "openrouter",
        "cerebras",
        "cursor",
        "custom",
      ].includes(provider)
    ) {
      errors.push(
        "Provider must be local, openai, gemini, groq, openrouter, cerebras, cursor, or custom",
      );
    } else {
      result.provider = provider;
    }
  }

  if (input.baseURL !== undefined) {
    try {
      result.baseURL = normalizeLlmBaseUrl(input.baseURL, providerHint);
      if (!result.provider) {
        result.provider = detectProviderFromBaseUrl(result.baseURL);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (input.model !== undefined) {
    const model = String(input.model ?? "").trim();
    if (!model) errors.push("LLM model name is required");
    else result.model = model;
  }

  if (input.context !== undefined) {
    const context = Number(input.context);
    if (!Number.isFinite(context) || context < 1024) {
      errors.push("LLM context must be a number ≥ 1024");
    } else if (context > 2_000_000) {
      errors.push("LLM context must be ≤ 2000000");
    } else {
      result.context = Math.floor(context);
    }
  }

  if (input.apiKey !== undefined) {
    const apiKey = String(input.apiKey ?? "").trim();
    if (apiKey) result.apiKey = apiKey;
  }

  const effectiveProvider =
    result.provider ??
    providerHint ??
    (result.baseURL
      ? detectProviderFromBaseUrl(result.baseURL)
      : detectProviderFromBaseUrl(config.llm.baseURL));

  if (
    result.apiKey &&
    effectiveProvider === "openrouter" &&
    !isAcceptedProviderApiKey("openrouter", result.apiKey)
  ) {
    errors.push(
      "OpenRouter API keys start with sk-or-v1- — get one at openrouter.ai/keys (OpenAI sk-proj- keys won't work)",
    );
  }

  if (
    requireApiKey &&
    providerRequiresApiKey(effectiveProvider) &&
    !willHaveApiKey(effectiveProvider, result)
  ) {
    const hints = {
      gemini: "Gemini API key required — set GEMINI_API_KEY in .env or paste in settings",
      groq: "Groq API key required — set GROQ_API_KEY or LLM_API_KEY in .env, or paste in settings",
      openrouter:
        "OpenRouter API key required — set OPENROUTER_API_KEY in .env or paste an sk-or-v1- key in settings",
      cerebras:
        "Cerebras API key required — set CEREBRAS_API_KEY in .env or paste in settings",
      cursor:
        "Cursor API key required — set CURSOR_API_KEY in .env or paste in settings",
      openai: "OpenAI API key required — set LLM_API_KEY or OPENAI_API_KEY in .env, or paste in settings",
      custom: "API key required for this endpoint — set LLM_API_KEY in .env or paste in settings",
    };
    errors.push(hints[effectiveProvider] ?? hints.custom);
  }

  if (errors.length) {
    const err = new Error(errors.join("; "));
    err.details = errors;
    throw err;
  }

  return result;
}

function parseRateLimitCap(value, { name, max }) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`${name} must be a number ≥ 1`);
  }
  if (n > max) {
    throw new Error(`${name} must be ≤ ${max}`);
  }
  return Math.floor(n);
}

function normalizeRateLimitEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const entry = {};
  if (raw.rpm !== undefined) {
    entry.rpm = parseRateLimitCap(raw.rpm, { name: "RPM", max: 10_000 });
  }
  if (raw.rpd !== undefined) {
    entry.rpd = parseRateLimitCap(raw.rpd, { name: "RPD", max: 10_000_000 });
  }
  if (raw.tpm !== undefined) {
    entry.tpm = parseRateLimitCap(raw.tpm, { name: "TPM", max: 50_000_000 });
  }
  if (raw.tpd !== undefined) {
    entry.tpd = parseRateLimitCap(raw.tpd, { name: "TPD", max: 500_000_000 });
  }
  return Object.keys(entry).length ? entry : null;
}

function normalizeRateLimitMap(raw, label) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const entry = normalizeRateLimitEntry(value);
    if (entry) out[String(key)] = entry;
  }
  return out;
}

export function validateRateLimitSettings(input = {}) {
  if (!input || typeof input !== "object") return {};
  const result = {};

  if (input.enabled !== undefined) {
    result.enabled = Boolean(input.enabled);
  }
  if (input.headroom !== undefined) {
    result.headroom = Boolean(input.headroom);
  }
  if (input.rpm !== undefined) {
    result.rpm = parseRateLimitCap(input.rpm, { name: "RPM", max: 10_000 });
  }
  if (input.rpd !== undefined) {
    result.rpd = parseRateLimitCap(input.rpd, { name: "RPD", max: 10_000_000 });
  }
  if (input.tpm !== undefined) {
    result.tpm = parseRateLimitCap(input.tpm, { name: "TPM", max: 50_000_000 });
  }
  if (input.tpd !== undefined) {
    result.tpd = parseRateLimitCap(input.tpd, { name: "TPD", max: 500_000_000 });
  }
  if (input.providers !== undefined) {
    result.providers = normalizeRateLimitMap(input.providers, "provider");
  }
  if (input.models !== undefined) {
    result.models = normalizeRateLimitMap(input.models, "model");
  }

  return result;
}

function buildRateLimitSnapshot() {
  const rl = config.llm.rateLimit ?? {};
  return {
    enabled: rl.enabled !== false,
    headroom: rl.headroom !== false,
    providers: { ...(rl.providers ?? {}) },
    models: { ...(rl.models ?? {}) },
  };
}

export function applyRateLimitSettings(partial, { provider, model } = {}) {
  if (!partial || typeof partial !== "object") return;

  const rl = config.llm.rateLimit;
  if (partial.enabled !== undefined) rl.enabled = partial.enabled;
  if (partial.headroom !== undefined) rl.headroom = partial.headroom;

  if (partial.providers) {
    rl.providers = { ...partial.providers };
  }
  if (partial.models) {
    rl.models = { ...partial.models };
  }

  const caps =
    partial.rpm !== undefined ||
    partial.rpd !== undefined ||
    partial.tpm !== undefined ||
    partial.tpd !== undefined
      ? {
          ...(partial.rpm !== undefined ? { rpm: partial.rpm } : {}),
          ...(partial.rpd !== undefined ? { rpd: partial.rpd } : {}),
          ...(partial.tpm !== undefined ? { tpm: partial.tpm } : {}),
          ...(partial.tpd !== undefined ? { tpd: partial.tpd } : {}),
        }
      : null;

  if (caps && provider) {
    rl.providers = {
      ...(rl.providers ?? {}),
      [provider]: {
        ...(rl.providers?.[provider] ?? {}),
        ...caps,
      },
    };
  }
  if (caps && model) {
    const modelId = normalizeModelId(model);
    if (modelId) {
      rl.models = {
        ...(rl.models ?? {}),
        [modelId]: {
          ...(rl.models?.[modelId] ?? {}),
          ...caps,
        },
      };
    }
  }
}

function loadRateLimitFromPersisted(llm) {
  if (!llm?.rateLimit || typeof llm.rateLimit !== "object") return;
  try {
    const validated = validateRateLimitSettings(llm.rateLimit);
    applyRateLimitSettings(validated);
  } catch (error) {
    console.warn("Invalid persisted rate-limit settings — using defaults:", error.message);
  }
}

export function applyLlmSettings(partial) {
  if (partial.provider !== undefined) {
    config.llm.provider = String(partial.provider);
  }
  if (partial.baseURL !== undefined) {
    const providerHint = partial.provider ?? config.llm.provider;
    config.llm.baseURL = normalizeLlmBaseUrl(partial.baseURL, providerHint);
    if (!partial.provider) {
      config.llm.provider = detectProviderFromBaseUrl(config.llm.baseURL);
    }
  }
  if (partial.model !== undefined) {
    config.llm.model = String(partial.model).trim();
  }
  if (partial.context !== undefined) {
    config.llm.context = Math.floor(Number(partial.context));
  }

  const provider = config.llm.provider ?? detectProviderFromBaseUrl(config.llm.baseURL);

  if (partial.apiKey !== undefined) {
    const key = sanitizeApiKey(partial.apiKey);
    if (key) {
      rememberProviderApiKey(provider, key);
      config.llm.apiKey = key;
    } else {
      activateProviderApiKey(provider);
    }
  } else {
    activateProviderApiKey(provider);
  }
}

function providerChanged(patch) {
  if (!patch.provider) return false;
  const current = config.llm.provider ?? detectProviderFromBaseUrl(config.llm.baseURL);
  return patch.provider !== current;
}

export function getLlmSettingsView() {
  const defaults = getEnvLlmDefaults();
  const provider = config.llm.provider ?? detectProviderFromBaseUrl(config.llm.baseURL);
  const apiKeysSet = buildApiKeysSetView();
  const rl = config.llm.rateLimit ?? {};

  return {
    provider,
    baseURL: config.llm.baseURL,
    model: config.llm.model,
    context: config.llm.context,
    apiKeySet: Boolean(apiKeysSet[provider]),
    apiKeysSet,
    providers: listProviderPresets(),
    defaults,
    persisted: persistedPayload?.llm ?? null,
    source: persistedPayload ? "database" : "defaults",
    rateLimit: {
      enabled: rl.enabled !== false,
      headroom: rl.headroom !== false,
      providers: { ...(rl.providers ?? {}) },
      models: { ...(rl.models ?? {}) },
      form: getRateLimitFormValues(provider, config.llm.model),
      effective: resolveLlmRateLimits(provider, config.llm.model),
      suggestions: getRateLimitSuggestions(),
      live: getRateLimitLiveState(provider),
    },
  };
}

let persistedLlmSnapshot = null;

export function getSettingsView() {
  const stored = loadAppSettings();
  const sections = {};
  for (const section of SETTING_SECTIONS) {
    sections[section] = extractSectionFromConfig(config, section);
  }
  const defaults = getCodeDefaultsBySection();
  const meta = {
    source: stored ? "database" : "defaults",
    updatedAt: stored?.updatedAt ?? null,
    restartPending: restartPendingSections,
    sections: Object.fromEntries(
      SETTING_SECTIONS.map((s) => [s, getSectionMeta(s)]),
    ),
  };
  return {
    sections,
    defaults,
    meta,
    llm: getLlmSettingsView(),
  };
}

export async function updateSettings({ section, values, sections: multi } = {}) {
  const current = persistedPayload ?? loadAppSettings()?.payload ?? getCodeDefaultsBySection();
  const next = structuredClone(current);

  if (section && values) {
    const validated = validateSectionPatch(section, values);
    next[section] = mergeSectionPayload(next[section] ?? {}, validated);
    applySectionToConfig(config, section, next[section]);
    if (section === "llm") applyLlmSectionFromPayload(next.llm);
  }

  if (multi && typeof multi === "object") {
    for (const [sec, vals] of Object.entries(multi)) {
      if (!SETTING_SECTIONS.includes(sec)) continue;
      const validated = validateSectionPatch(sec, vals);
      next[sec] = mergeSectionPayload(next[sec] ?? {}, validated);
      applySectionToConfig(config, sec, next[sec]);
    }
    if (next.llm) applyLlmSectionFromPayload(next.llm);
  }

  await persistSettingsPayload(next);
  return getSettingsView();
}

export async function resetSettings({ section } = {}) {
  const defaults = getCodeDefaultsBySection();
  const current = persistedPayload ?? loadAppSettings()?.payload ?? defaults;

  if (!section) {
    applySettingsOverlay(config, defaults);
    config.llm.apiKeys = {};
    bootstrapApiKeysFromEnv();
    persistedPayload = null;
    restartPendingSections = [];
    deleteAppSettings();
    seedAppSettingsIfEmpty();
    const seeded = loadAppSettings()?.payload ?? defaults;
    applySettingsOverlay(config, seeded);
    applyLlmSectionFromPayload(seeded.llm);
    bootstrapApiKeysFromEnv();
    persistedPayload = seeded;
    await persistSettingsPayload(seeded);
    return getSettingsView();
  }

  if (!SETTING_SECTIONS.includes(section)) {
    throw new Error(`Unknown settings section: ${section}`);
  }

  const next = structuredClone(current);
  next[section] = structuredClone(defaults[section]);
  applySectionToConfig(config, section, next[section]);
  if (section === "llm") {
    applyLlmSectionFromPayload(next.llm);
    bootstrapApiKeysFromEnv();
  }
  await persistSettingsPayload(next);
  return getSettingsView();
}

function buildPersistedLlmSnapshot(validated) {
  const provider =
    validated.provider ??
    config.llm.provider ??
    detectProviderFromBaseUrl(config.llm.baseURL);
  return {
    provider,
    baseURL: validated.baseURL ?? config.llm.baseURL,
    model: validated.model ?? config.llm.model,
    context: validated.context ?? config.llm.context,
    apiKeys: { ...config.llm.apiKeys },
    rateLimit: buildRateLimitSnapshot(),
  };
}

function isLegacyWorkspaceDir(dir) {
  const normalized = path.resolve(String(dir ?? "")).replace(/\\/g, "/");
  return normalized.endsWith("/src/lib/workspace");
}

/** WORKSPACE_DIR in .env wins; migrate bad persisted paths from an old settings default. */
async function syncWorkspaceDirFromEnv() {
  const envWorkspace = process.env.WORKSPACE_DIR
    ? path.resolve(process.env.WORKSPACE_DIR)
    : null;
  const previous = config.workspaceDir;

  if (envWorkspace) {
    config.workspaceDir = envWorkspace;
  } else if (isLegacyWorkspaceDir(config.workspaceDir)) {
    config.workspaceDir = path.resolve(path.join(rootDirFromConfig(), "../.."));
  }

  const storedDir = persistedPayload?.workspace?.workspaceDir;
  const needsPersist =
    config.workspaceDir !== previous ||
    (storedDir != null && storedDir !== config.workspaceDir);

  if (needsPersist && persistedPayload?.workspace) {
    persistedPayload.workspace.workspaceDir = config.workspaceDir;
    await persistSettingsPayload(persistedPayload);
  }
}

function rootDirFromConfig() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export async function initSettings() {
  seedAppSettingsIfEmpty();
  await migrateLegacySettingsFile();

  const stored = loadAppSettings();
  if (stored?.payload) {
    persistedPayload = stored.payload;
    applySettingsOverlay(config, stored.payload);
    applyInternalPayloadExtras(stored.payload);
    applyLlmSectionFromPayload(stored.payload.llm);
  } else {
    const defaults = getCodeDefaultsBySection();
    persistedPayload = defaults;
    applySettingsOverlay(config, defaults);
  }

  await syncWorkspaceDirFromEnv();

  bootstrapApiKeysFromEnv();
  persistedLlmSnapshot = buildPersistedLlmSnapshot({});
}

export async function updateLlmSettings(input) {
  const validated = validateLlmSettings(input);
  const rateLimitPatch =
    input.rateLimit !== undefined
      ? validateRateLimitSettings(input.rateLimit)
      : null;
  const oldProvider = config.llm.provider ?? detectProviderFromBaseUrl(config.llm.baseURL);
  const newProvider =
    validated.provider ??
    oldProvider;

  if (providerChanged(validated)) {
    rememberProviderApiKey(oldProvider, config.llm.apiKey);
  }

  if (validated.apiKey) {
    rememberProviderApiKey(newProvider, validated.apiKey);
  }

  applyLlmSettings(validated);
  if (rateLimitPatch) {
    const model = validated.model ?? config.llm.model;
    applyRateLimitSettings(rateLimitPatch, { provider: newProvider, model });
  }
  activateProviderApiKey(newProvider, validated.apiKey);

  const resolved = resolveLlmApiKey(newProvider);
  if (resolved) rememberProviderApiKey(newProvider, resolved);

  const current = persistedPayload ?? loadAppSettings()?.payload ?? getCodeDefaultsBySection();
  const next = structuredClone(current);
  next.llm = mergeSectionPayload(next.llm ?? {}, {
    provider: config.llm.provider,
    baseURL: config.llm.baseURL,
    model: config.llm.model,
    context: config.llm.context,
    rateLimitEnabled: config.llm.rateLimit?.enabled !== false,
    rateLimitHeadroom: config.llm.rateLimit?.headroom !== false,
  });
  await persistSettingsPayload(next);
  persistedLlmSnapshot = buildPersistedLlmSnapshot(validated);

  return getLlmSettingsView();
}

export async function applyLlmProviderPreset(providerId, { apiKey } = {}) {
  const preset = applyProviderDefaults(providerId);
  if (!preset) throw new Error(`Unknown provider: ${providerId}`);
  return updateLlmSettings({
    ...preset,
    ...(apiKey ? { apiKey } : {}),
  });
}

export async function resetLlmSettings() {
  return resetSettings({ section: "llm" }).then(() => getLlmSettingsView());
}

export async function testLlmConnection(overrides = {}) {
  const snapshot = {
    provider: config.llm.provider,
    baseURL: config.llm.baseURL,
    model: config.llm.model,
    context: config.llm.context,
    apiKey: config.llm.apiKey,
    apiKeys: { ...config.llm.apiKeys },
  };

  if (overrides && Object.keys(overrides).length) {
    const validated = validateLlmSettings(overrides);
    applyLlmSettings(validated);
  }

  const provider = config.llm.provider ?? detectProviderFromBaseUrl(config.llm.baseURL);

  if (provider === "cursor") {
    const apiKey = resolveLlmApiKey("cursor");
    if (!apiKey) {
      throw new Error(
        "No Cursor API key configured. Paste your key in Settings or set CURSOR_API_KEY in .env.",
      );
    }

    const { Cursor } = await import("@cursor/sdk");
    const models = await Cursor.models.list({ apiKey });
    const modelIds = models
      .map((m) => m.id ?? m.name ?? m)
      .filter(Boolean)
      .slice(0, 20);

    const modelListed = modelIds.some(
      (m) => String(m) === config.llm.model || String(m).includes(config.llm.model),
    );

    return {
      ok: true,
      provider,
      baseURL: config.llm.baseURL,
      model: config.llm.model,
      context: config.llm.context,
      modelsFound: modelIds.length,
      modelListed: modelIds.length ? modelListed : null,
      sampleModels: modelIds.slice(0, 5),
      rateLimitLive: null,
    };
  }

  const { buildLlmAuthHeaders } = await import("./llmProviders.js");

  try {
    const response = await fetch(`${config.llm.baseURL}/models`, {
      method: "GET",
      headers: buildLlmAuthHeaders(provider),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 401) {
        const key = resolveLlmApiKey(provider);
        const hint =
          provider === "openrouter"
            ? !key
              ? "No OpenRouter key configured. Paste an sk-or-v1- key in Settings or set OPENROUTER_API_KEY in .env."
              : "The OpenRouter key is invalid. Keys must start with sk-or-v1- (get one at openrouter.ai/keys)."
            : !key
              ? "No API key is configured. Paste your key in Settings or set the provider key in .env."
              : "The API key is invalid or belongs to a different provider. Create a new key and save again.";
        throw new Error(`Invalid API key (401). ${hint}`);
      }
      throw new Error(`LLM API unreachable (${response.status}): ${text.slice(0, 200)}`);
    }

    let models = [];
    try {
      const data = await response.json();
      models = (data.data ?? data.models ?? [])
        .map((m) => m.id ?? m.name ?? m)
        .filter(Boolean)
        .slice(0, 20);
    } catch {
      // Some providers return non-JSON — connection still ok
    }

    const modelListed = models.some(
      (m) => String(m) === config.llm.model || String(m).includes(config.llm.model),
    );

    ingestGroqRateLimitHeaders(provider, response.headers);
    const groqLive = getRateLimitLiveState(provider);

    return {
      ok: true,
      provider,
      baseURL: config.llm.baseURL,
      model: config.llm.model,
      context: config.llm.context,
      modelsFound: models.length,
      modelListed: models.length ? modelListed : null,
      sampleModels: models.slice(0, 5),
      rateLimitLive: groqLive,
    };
  } finally {
    if (overrides && Object.keys(overrides).length) {
      applyLlmSettings(snapshot);
      config.llm.apiKeys = { ...snapshot.apiKeys };
    }
  }
}
