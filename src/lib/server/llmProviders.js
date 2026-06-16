import { config } from "./config.js";

/** @typedef {"local" | "openai" | "gemini" | "groq" | "openrouter" | "cerebras" | "cursor" | "custom"} LlmProviderId */

export const CURSOR_SDK_BASE_URL = "cursor://sdk";

export const LLM_PROVIDER_PRESETS = {
  local: {
    id: "local",
    label: "Local (llama.cpp / Ollama)",
    baseURL: "http://localhost:11434/v1",
    model: "gemma-4-E2B-it-Q4_K_M.gguf",
    context: 131072,
    slotsEnabled: true,
    apiKeyRequired: false,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    context: 128000,
    slotsEnabled: false,
    apiKeyRequired: true,
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
    context: 1048576,
    slotsEnabled: false,
    apiKeyRequired: true,
    apiKeyHint: "Get a key at aistudio.google.com/apikey",
  },
  groq: {
    id: "groq",
    label: "Groq (free tier)",
    baseURL: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    context: 131072,
    slotsEnabled: false,
    apiKeyRequired: true,
    apiKeyHint: "Get a key at console.groq.com/keys — set GROQ_API_KEY or paste here",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    model: "openrouter/free",
    context: 131072,
    slotsEnabled: false,
    apiKeyRequired: true,
    apiKeyHint:
      "Get a key at openrouter.ai/keys (sk-or-v1-...) — set OPENROUTER_API_KEY or paste here",
  },
  cerebras: {
    id: "cerebras",
    label: "Cerebras",
    baseURL: "https://api.cerebras.ai/v1",
    model: "gpt-oss-120b",
    context: 131072,
    slotsEnabled: false,
    apiKeyRequired: true,
    apiKeyHint:
      "Get a key at cloud.cerebras.ai — set CEREBRAS_API_KEY or paste here",
  },
  cursor: {
    id: "cursor",
    label: "Cursor (Composer SDK)",
    baseURL: CURSOR_SDK_BASE_URL,
    model: "auto",
    context: 200000,
    slotsEnabled: false,
    apiKeyRequired: true,
    apiKeyHint:
      "Get a key at cursor.com/dashboard/integrations — set CURSOR_API_KEY or paste here. Use model `auto` if composer-* fails.",
  },
};

const GEMINI_HOST = "generativelanguage.googleapis.com";
const OPENAI_HOST = "api.openai.com";
const GROQ_HOST = "api.groq.com";
const OPENROUTER_HOST = "openrouter.ai";
const CEREBRAS_HOST = "api.cerebras.ai";

export function sanitizeApiKey(value) {
  const key = String(value ?? "").trim();
  if (!key || key === "not-needed") return "";
  return key.replace(/^["']|["']$/g, "");
}

export function detectProviderFromBaseUrl(baseURL) {
  const url = String(baseURL ?? "").toLowerCase();
  if (url.startsWith("cursor://")) return "cursor";
  if (url.includes(GEMINI_HOST)) return "gemini";
  if (url.includes(GROQ_HOST)) return "groq";
  if (url.includes(OPENROUTER_HOST)) return "openrouter";
  if (url.includes(CEREBRAS_HOST)) return "cerebras";
  if (url.includes(OPENAI_HOST)) return "openai";
  if (/localhost|127\.0\.0\.1/.test(url)) return "local";
  return "custom";
}

export function providerRequiresApiKey(providerId) {
  return [
    "openai",
    "gemini",
    "groq",
    "openrouter",
    "cerebras",
    "cursor",
    "custom",
  ].includes(providerId);
}

export function isCursorProvider(providerId = getActiveProviderId()) {
  return providerId === "cursor";
}

export function buildCursorModelSelection(modelId = config.llm.model) {
  const raw = String(modelId ?? "").trim() || "auto";
  // composer-* often fails on local SDK runtime; `auto` resolves a working model server-side.
  if (/^composer(-|$)/i.test(raw)) {
    return { id: "auto", _requested: raw };
  }
  return { id: raw };
}

export function isCursorComposerModel(modelId = config.llm.model) {
  return /^composer(-|$)/i.test(String(modelId ?? "").trim());
}

export function usesRemoteModelsProbe(providerId) {
  return providerId !== "local";
}

export function getActiveProviderId() {
  return config.llm.provider ?? detectProviderFromBaseUrl(config.llm.baseURL);
}

export function isGeminiProvider(baseURL = config.llm.baseURL) {
  return String(baseURL).toLowerCase().includes(GEMINI_HOST);
}

export function shouldUseLlmSlots(baseURL = config.llm.baseURL) {
  if (!config.llm.slotsEnabled) return false;
  return !isGeminiProvider(baseURL) && detectProviderFromBaseUrl(baseURL) === "local";
}

/**
 * Normalize base URL per provider. Gemini uses /v1beta/openai — not /v1.
 */
export function normalizeLlmBaseUrl(input, providerHint) {
  let url = String(input ?? "").trim();
  if (!url) throw new Error("LLM base URL is required");

  const provider = providerHint ?? detectProviderFromBaseUrl(url);
  if (provider === "cursor" || url.startsWith("cursor://")) {
    return CURSOR_SDK_BASE_URL;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("LLM base URL must be a valid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("LLM base URL must use http or https");
  }

  url = parsed.toString().replace(/\/+$/, "");

  if (provider === "gemini" || url.includes(GEMINI_HOST)) {
    if (!url.includes("/v1beta/openai")) {
      if (url.endsWith("/v1beta")) {
        url = `${url}/openai`;
      } else if (url.includes(GEMINI_HOST) && !url.includes("/openai")) {
        url = `${url.replace(/\/v1$/, "")}/v1beta/openai`;
        if (!url.includes("/v1beta/openai")) {
          url = `https://${GEMINI_HOST}/v1beta/openai`;
        }
      }
    }
    return url.replace(/\/+$/, "");
  }

  if (!url.endsWith("/v1")) {
    url = `${url}/v1`;
  }
  return url;
}

export function isAcceptedProviderApiKey(providerId, key) {
  const clean = sanitizeApiKey(key);
  if (!clean) return false;
  if (providerId === "openrouter") {
    return clean.startsWith("sk-or-");
  }
  return true;
}

export function resolveEnvApiKey(providerId = getActiveProviderId()) {
  if (providerId === "gemini") {
    return sanitizeApiKey(
      process.env.GEMINI_API_KEY ??
        process.env.GOOGLE_API_KEY ??
        process.env.LLM_API_KEY,
    );
  }

  if (providerId === "groq") {
    return sanitizeApiKey(process.env.GROQ_API_KEY ?? process.env.LLM_API_KEY);
  }

  if (providerId === "openai") {
    return sanitizeApiKey(process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY);
  }

  if (providerId === "openrouter") {
    const dedicated = sanitizeApiKey(process.env.OPENROUTER_API_KEY);
    if (dedicated) return dedicated;
    const generic = sanitizeApiKey(process.env.LLM_API_KEY);
    if (generic.startsWith("sk-or-")) return generic;
    return "";
  }

  if (providerId === "cerebras") {
    return sanitizeApiKey(process.env.CEREBRAS_API_KEY ?? process.env.LLM_API_KEY);
  }

  if (providerId === "cursor") {
    return sanitizeApiKey(process.env.CURSOR_API_KEY ?? process.env.LLM_API_KEY);
  }

  return sanitizeApiKey(
    process.env.LLM_API_KEY ??
      process.env.OPENROUTER_API_KEY ??
      process.env.CEREBRAS_API_KEY ??
      process.env.GROQ_API_KEY ??
      process.env.OPENAI_API_KEY,
  );
}

export function resolveLlmApiKey(providerId = getActiveProviderId()) {
  const id = providerId ?? getActiveProviderId();

  const fromStore = sanitizeApiKey(config.llm.apiKeys?.[id]);
  if (fromStore && isAcceptedProviderApiKey(id, fromStore)) return fromStore;

  const fromEnv = resolveEnvApiKey(id);
  if (fromEnv && isAcceptedProviderApiKey(id, fromEnv)) return fromEnv;

  if (id === getActiveProviderId()) {
    const active = sanitizeApiKey(config.llm.apiKey);
    if (active && isAcceptedProviderApiKey(id, active)) return active;
  }

  return "";
}

/** Sync config.llm.apiKey from the provider-specific key store. */
export function ensureProviderApiKey(providerId = getActiveProviderId()) {
  const key = resolveLlmApiKey(providerId);
  config.llm.apiKey = key || "not-needed";
  return key;
}

/** @deprecated use ensureProviderApiKey */
export function hydrateLlmApiKeyFromEnv(providerId = getActiveProviderId()) {
  return Boolean(ensureProviderApiKey(providerId));
}

export function buildLlmAuthHeaders(providerId = getActiveProviderId()) {
  const apiKey = ensureProviderApiKey(providerId);
  const headers = { "Content-Type": "application/json" };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

export function getLlmAuthHeadersForRequest() {
  return buildLlmAuthHeaders();
}

export function applyProviderDefaults(providerId) {
  const preset = LLM_PROVIDER_PRESETS[providerId];
  if (!preset) return null;
  return {
    provider: preset.id,
    baseURL: preset.baseURL,
    model: preset.model,
    context: preset.context,
  };
}

export function listProviderPresets() {
  return Object.values(LLM_PROVIDER_PRESETS).map((p) => ({
    id: p.id,
    label: p.label,
    baseURL: p.baseURL,
    model: p.model,
    context: p.context,
    apiKeyRequired: p.apiKeyRequired,
    apiKeyHint: p.apiKeyHint ?? null,
  }));
}

/**
 * Lightweight reachability check for /api/health and status UI.
 */
export async function probeLlmHealth(providerId = getActiveProviderId()) {
  if (isCursorProvider(providerId)) {
    const apiKey = resolveLlmApiKey(providerId);
    if (!apiKey) return false;
    try {
      const { Cursor } = await import("@cursor/sdk");
      const models = await Cursor.models.list({ apiKey });
      return Array.isArray(models);
    } catch {
      return false;
    }
  }

  if (usesRemoteModelsProbe(providerId)) {
    try {
      const response = await fetch(`${config.llm.baseURL}/models`, {
        headers: buildLlmAuthHeaders(providerId),
        signal: AbortSignal.timeout(8000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  try {
    const response = await fetch(`${config.llm.baseURL.replace(/\/v1$/, "")}/health`, {
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
