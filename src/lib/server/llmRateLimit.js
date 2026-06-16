import { config } from "./config.js";
import { emitRateLimitStreamEvent } from "./rateLimitNotify.js";

/** @typedef {{ rpm: number | null, rpd: number | null, tpm: number | null, tpd: number | null, enabled: boolean }} LlmRateLimits */

const CAP_FIELDS = ["rpm", "rpd", "tpm", "tpd"];

/** Conservative defaults — enter tier caps in Settings; headroom applies below. */
export const PROVIDER_RATE_LIMITS = {
  gemini: { rpm: 15, rpd: 1500, tpm: 1_000_000, tpd: null },
  groq: { rpm: 30, rpd: 14_400, tpm: 6000, tpd: null },
  openai: { rpm: 60, rpd: null, tpm: 150_000, tpd: null },
  openrouter: { rpm: 20, rpd: null, tpm: null, tpd: null },
  cerebras: { rpm: 30, rpd: null, tpm: 60_000, tpd: null },
  custom: { rpm: 15, rpd: null, tpm: null, tpd: null },
};

/** Model-specific tier caps (provider-agnostic key = normalized model id). */
export const MODEL_RATE_LIMITS = {
  "gemma-4-31b-it": { rpm: 15, rpd: 1500, tpm: 1_000_000, tpd: null },
  "gemma-4-31b": { rpm: 15, rpd: 1500, tpm: 1_000_000, tpd: null },
  "llama-3.3-70b-versatile": { rpm: 30, rpd: 14_400, tpm: 6000, tpd: null },
};

const RPM_WINDOW_MS = 60_000;
const RETRYABLE_STATUSES = new Set([429, 503]);
const GROQ_HEADER_STALE_MS = 120_000;

/** @type {Map<string, number[]>} */
const rpmWindows = new Map();
/** @type {Map<string, number>} */
const dailyRequestCounts = new Map();
/** @type {Map<string, Array<{ t: number, tokens: number }>>} */
const tpmWindows = new Map();
/** @type {Map<string, number>} */
const dailyTokenCounts = new Map();

/**
 * Live Groq quota from x-ratelimit-* response headers (org-level).
 * @type {Map<string, GroqLiveLimits>}
 */
const groqLiveByProvider = new Map();

/**
 * @typedef {{
 *   limitRequests: number | null,
 *   limitTokens: number | null,
 *   remainingRequests: number | null,
 *   remainingTokens: number | null,
 *   resetRequestsMs: number | null,
 *   resetTokensMs: number | null,
 *   updatedAt: number,
 * }} GroqLiveLimits
 */

export function normalizeModelId(model) {
  return String(model ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.gguf$/i, "");
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function rateLimitKey(providerId, model) {
  return `${providerId}:${normalizeModelId(model) || "default"}`;
}

function pruneRpmWindow(timestamps, now = Date.now()) {
  const cutoff = now - RPM_WINDOW_MS;
  while (timestamps.length && timestamps[0] < cutoff) {
    timestamps.shift();
  }
}

function pruneTpmWindow(entries, now = Date.now()) {
  const cutoff = now - RPM_WINDOW_MS;
  while (entries.length && entries[0].t < cutoff) {
    entries.shift();
  }
}

function tpmUsedInWindow(entries, now = Date.now()) {
  const cutoff = now - RPM_WINDOW_MS;
  let sum = 0;
  for (const entry of entries) {
    if (entry.t >= cutoff) sum += entry.tokens;
  }
  return sum;
}

function pickCap(field, ...sources) {
  for (const source of sources) {
    if (source?.[field] != null) return source[field];
  }
  return null;
}

function buildCapsFromSources(sources) {
  /** @type {Record<string, number | null>} */
  const caps = {};
  for (const field of CAP_FIELDS) {
    caps[field] = pickCap(field, ...sources);
  }
  return caps;
}

/**
 * Apply safety margin so configured caps stay under provider tier limits.
 */
export function applyRateLimitHeadroom(caps, headroom = true) {
  if (!headroom) return { ...caps };
  return {
    rpm: caps.rpm != null ? Math.max(1, caps.rpm - 1) : null,
    rpd: caps.rpd != null ? Math.max(1, caps.rpd - 50) : null,
    tpm:
      caps.tpm != null
        ? Math.max(1000, caps.tpm - 500)
        : null,
    tpd:
      caps.tpd != null
        ? Math.max(1000, caps.tpd - 5000)
        : null,
  };
}

function resolveRawRateLimits(providerId, model) {
  const normalized = normalizeModelId(model);
  const rl = config.llm.rateLimit ?? {};

  if (
    rl.rpm != null ||
    rl.rpd != null ||
    rl.tpm != null ||
    rl.tpd != null
  ) {
    return buildCapsFromSources([
      { rpm: rl.rpm, rpd: rl.rpd, tpm: rl.tpm, tpd: rl.tpd },
    ]);
  }

  const modelSettings = rl.models?.[normalized];
  const providerSettings = rl.providers?.[providerId];
  const modelPreset = MODEL_RATE_LIMITS[normalized] ?? null;
  const providerPreset =
    PROVIDER_RATE_LIMITS[providerId] ?? PROVIDER_RATE_LIMITS.custom;

  return buildCapsFromSources([
    modelSettings,
    providerSettings,
    modelPreset,
    providerPreset,
  ]);
}

/** Raw saved/form values for a provider+model (before headroom). */
export function getRateLimitFormValues(providerId, model) {
  return resolveRawRateLimits(providerId, model);
}

export function getRateLimitSuggestions() {
  return {
    providers: { ...PROVIDER_RATE_LIMITS },
    models: { ...MODEL_RATE_LIMITS },
  };
}

function normalizeCap(value) {
  return typeof value === "number" && value > 0 ? value : null;
}

/**
 * Resolve proactive rate limits for a provider/model pair.
 * Priority: env override → model settings → provider settings → built-in presets.
 */
export function resolveLlmRateLimits(providerId, model) {
  if (providerId === "local") {
    return { rpm: null, rpd: null, tpm: null, tpd: null, enabled: false };
  }

  const enabled = config.llm.rateLimit?.enabled !== false;
  if (!enabled) {
    return { rpm: null, rpd: null, tpm: null, tpd: null, enabled: false };
  }

  const raw = resolveRawRateLimits(providerId, model);
  const headroom = config.llm.rateLimit?.headroom !== false;
  const effective = applyRateLimitHeadroom(raw, headroom);

  const limits = {
    rpm: normalizeCap(effective.rpm),
    rpd: normalizeCap(effective.rpd),
    tpm: normalizeCap(effective.tpm),
    tpd: normalizeCap(effective.tpd),
    enabled: false,
  };
  limits.enabled = Boolean(
    limits.rpm || limits.rpd || limits.tpm || limits.tpd,
  );
  return limits;
}

export function parseGroqResetDuration(value) {
  if (!value) return null;
  const str = String(value).trim();
  let ms = 0;
  const minMatch = str.match(/(\d+)m/);
  const secMatch = str.match(/(\d+(?:\.\d+)?)s/);
  if (minMatch) ms += Number(minMatch[1]) * 60_000;
  if (secMatch) ms += Math.ceil(Number(secMatch[1]) * 1000);
  return ms > 0 ? ms : null;
}

function parseHeaderInt(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/**
 * Parse Groq x-ratelimit-* headers.
 * @see https://console.groq.com/docs/rate-limits
 */
export function parseGroqRateLimitHeaders(headers) {
  const get = (name) =>
    typeof headers?.get === "function" ? headers.get(name) : headers?.[name];

  return {
    limitRequests: parseHeaderInt(get("x-ratelimit-limit-requests")),
    limitTokens: parseHeaderInt(get("x-ratelimit-limit-tokens")),
    remainingRequests: parseHeaderInt(get("x-ratelimit-remaining-requests")),
    remainingTokens: parseHeaderInt(get("x-ratelimit-remaining-tokens")),
    resetRequestsMs: parseGroqResetDuration(get("x-ratelimit-reset-requests")),
    resetTokensMs: parseGroqResetDuration(get("x-ratelimit-reset-tokens")),
    updatedAt: Date.now(),
  };
}

export function ingestGroqRateLimitHeaders(providerId, headers) {
  if (providerId !== "groq" || !headers) return null;

  const parsed = parseGroqRateLimitHeaders(headers);
  const hasSignal =
    parsed.limitRequests != null ||
    parsed.limitTokens != null ||
    parsed.remainingRequests != null ||
    parsed.remainingTokens != null;
  if (!hasSignal) return null;

  groqLiveByProvider.set(providerId, parsed);
  return parsed;
}

export function getGroqLiveRateLimits(providerId = "groq") {
  const live = groqLiveByProvider.get(providerId);
  if (!live) return null;
  if (Date.now() - live.updatedAt > GROQ_HEADER_STALE_MS) return null;
  return { ...live };
}

export function getRateLimitLiveState(providerId) {
  if (providerId === "groq") {
    return getGroqLiveRateLimits(providerId);
  }
  return null;
}

/**
 * Estimate tokens for a chat completion request (input + max output).
 */
export function estimateRequestTokens(init) {
  if (!init?.body) return 1024;
  try {
    const body =
      typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    let tokens = 0;
    for (const message of body.messages ?? []) {
      const content = message?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .map((part) =>
                  typeof part === "string"
                    ? part
                    : (part?.text ?? JSON.stringify(part ?? "")),
                )
                .join("")
            : JSON.stringify(content ?? "");
      tokens += Math.ceil(String(text).length / 4);
    }
    tokens += Math.ceil(Number(body.max_tokens ?? 0));
    return Math.max(1, tokens);
  } catch {
    return 4096;
  }
}

/** @param {number} attempt 0-based retry index */
export function computeRetryDelayMs(attempt, retryAfterHeader) {
  const maxBackoff = config.llm.rateLimit?.maxBackoffMs ?? 120_000;
  const baseBackoff = config.llm.rateLimit?.baseBackoffMs ?? 1_000;

  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(Math.ceil(seconds * 1000), maxBackoff);
    }
  }

  const exp = baseBackoff * 2 ** Math.max(0, attempt);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(exp + jitter, maxBackoff);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function limitTypeLabel(limitType) {
  const labels = {
    rpm: "request-per-minute cap",
    rpd: "daily request cap",
    tpm: "tokens-per-minute cap",
    tpd: "daily token cap",
    "groq-tpm": "Groq token quota",
    "groq-rpd": "Groq daily request quota",
    retry: "provider rate limit",
  };
  return labels[limitType] ?? "rate limit";
}

async function sleepWithRateLimitNotify(waitMs, meta = {}) {
  if (waitMs < 1000) {
    await sleep(waitMs);
    return;
  }

  const totalMs = waitMs;
  let remaining = totalMs;
  const tickMs = 1000;
  const limitType = meta.limitType ?? null;

  const emitSnapshot = (ms) => {
    const seconds = Math.max(1, Math.ceil(ms / 1000));
    const label = meta.reason?.includes("HTTP")
      ? `Paused ~${seconds}s — provider asked us to slow down`
      : `Paused ~${seconds}s — ${limitTypeLabel(limitType)}`;
    emitRateLimitStreamEvent({
      type: "rate_limit_wait",
      waitMs: ms,
      seconds,
      totalMs,
      limitType,
      reason: meta.reason ?? null,
      provider: meta.providerId ?? null,
      label,
    });
  };

  emitSnapshot(remaining);
  while (remaining > 0) {
    const step = Math.min(tickMs, remaining);
    await sleep(step);
    remaining -= step;
    if (remaining > 0) {
      emitRateLimitStreamEvent({
        type: "rate_limit_tick",
        remainingMs: remaining,
        seconds: Math.max(1, Math.ceil(remaining / 1000)),
        limitType,
        label: `Paused ~${Math.max(1, Math.ceil(remaining / 1000))}s — ${limitTypeLabel(limitType)}`,
      });
    }
  }
  emitRateLimitStreamEvent({ type: "rate_limit_resume" });
}

export class RateLimitRequestTooLargeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RateLimitRequestTooLargeError";
    this.details = details;
  }
}

function throwRequestExceedsCap({
  providerId,
  model,
  tokens,
  cap,
  capType,
}) {
  const message =
    `Request estimates ~${tokens.toLocaleString()} tokens but your ${capType} cap is ${cap.toLocaleString()} (${providerId}). ` +
    "The prompt is too large for this tier — compact the conversation, reduce context in Settings, or raise TPM / pick a higher tier.";
  emitRateLimitStreamEvent({
    type: "rate_limit_error",
    label: message,
    tokens,
    cap,
    capType,
    provider: providerId,
    model: normalizeModelId(model),
  });
  throw new RateLimitRequestTooLargeError(message, {
    tokens,
    cap,
    capType,
    providerId,
    model: normalizeModelId(model),
  });
}

function assertRequestFitsCaps(limits, tokens, { providerId, model, key }) {
  if (!limits.enabled || tokens <= 0) return;

  if (limits.tpm != null && tokens > limits.tpm) {
    throwRequestExceedsCap({
      providerId,
      model,
      tokens,
      cap: limits.tpm,
      capType: "TPM",
    });
  }

  if (limits.tpd != null && tokens > limits.tpd) {
    throwRequestExceedsCap({
      providerId,
      model,
      tokens,
      cap: limits.tpd,
      capType: "TPD",
    });
  }

  const tpdUsed = dailyTokenCountFor(key);
  if (
    limits.tpd != null &&
    tpdUsed + tokens > limits.tpd &&
    limits.tpd - tpdUsed < tokens
  ) {
    throwRequestExceedsCap({
      providerId,
      model,
      tokens,
      cap: limits.tpd - tpdUsed,
      capType: "remaining daily token",
    });
  }
}

function assertGroqRequestFitsLiveCap(providerId, estimatedTokens, model) {
  const live = getGroqLiveRateLimits(providerId);
  if (!live?.limitTokens || estimatedTokens <= 0) return;

  if (estimatedTokens > live.limitTokens) {
    throwRequestExceedsCap({
      providerId,
      model,
      tokens: estimatedTokens,
      cap: live.limitTokens,
      capType: "Groq TPM",
    });
  }
}

function dailyRequestCountFor(key) {
  const dayKey = `req:${key}:${todayKey()}`;
  return dailyRequestCounts.get(dayKey) ?? 0;
}

function recordDailyRequest(key) {
  const dayKey = `req:${key}:${todayKey()}`;
  dailyRequestCounts.set(dayKey, (dailyRequestCounts.get(dayKey) ?? 0) + 1);
}

function dailyTokenCountFor(key) {
  const dayKey = `tok:${key}:${todayKey()}`;
  return dailyTokenCounts.get(dayKey) ?? 0;
}

function recordDailyTokens(key, tokens) {
  const dayKey = `tok:${key}:${todayKey()}`;
  dailyTokenCounts.set(dayKey, (dailyTokenCounts.get(dayKey) ?? 0) + tokens);
}

async function waitForGroqLiveQuota(providerId, estimatedTokens, model) {
  const live = getGroqLiveRateLimits(providerId);
  if (!live) return;

  assertGroqRequestFitsLiveCap(providerId, estimatedTokens, model);

  let waitMs = 0;
  let reason = "";

  if (
    live.remainingTokens != null &&
    estimatedTokens > live.remainingTokens &&
    live.resetTokensMs
  ) {
    waitMs = Math.max(waitMs, live.resetTokensMs);
    reason = `Groq TPM remaining ${live.remainingTokens}`;
  }

  if (
    live.remainingRequests != null &&
    live.remainingRequests < 1 &&
    live.resetRequestsMs
  ) {
    waitMs = Math.max(waitMs, live.resetRequestsMs);
    reason = reason
      ? `${reason}; Groq RPD exhausted`
      : "Groq RPD exhausted";
  }

  if (waitMs > 0) {
    waitMs = Math.min(waitMs, 120_000);
    const limitType =
      reason.includes("RPD") || reason.includes("exhausted")
        ? "groq-rpd"
        : "groq-tpm";
    console.warn(
      `[llm-rate-limit] ${providerId}: waiting ${Math.ceil(waitMs / 1000)}s (${reason})`,
    );
    await sleepWithRateLimitNotify(waitMs, {
      providerId,
      limitType,
      reason,
    });
  }
}

/**
 * Block until RPM/RPD/TPM/TPD slots are available (no-op for local / disabled limits).
 */
export async function acquireLlmRateLimitSlot({
  providerId,
  model,
  estimatedTokens = 0,
}) {
  const limits = resolveLlmRateLimits(providerId, model);
  if (!limits.enabled && providerId !== "groq") return;

  const key = rateLimitKey(providerId, model);
  const tokens = Math.max(0, Math.floor(estimatedTokens));

  assertRequestFitsCaps(limits, tokens, { providerId, model, key });

  while (true) {
    if (providerId === "groq") {
      await waitForGroqLiveQuota(providerId, tokens || 1024, model);
    }

    if (!limits.enabled) return;

    const now = Date.now();
    const timestamps = rpmWindows.get(key) ?? [];
    pruneRpmWindow(timestamps, now);

    const tpmEntries = tpmWindows.get(key) ?? [];
    pruneTpmWindow(tpmEntries, now);
    const tpmUsed = tpmUsedInWindow(tpmEntries, now);

    const rpmFull =
      limits.rpm != null && timestamps.length >= limits.rpm;
    const rpdFull =
      limits.rpd != null && dailyRequestCountFor(key) >= limits.rpd;
    const tpmFull =
      limits.tpm != null &&
      tokens > 0 &&
      tpmUsed + tokens > limits.tpm;
    const tpdFull =
      limits.tpd != null &&
      tokens > 0 &&
      dailyTokenCountFor(key) + tokens > limits.tpd;

    if (!rpmFull && !rpdFull && !tpmFull && !tpdFull) {
      timestamps.push(now);
      rpmWindows.set(key, timestamps);
      recordDailyRequest(key);
      if (tokens > 0) {
        tpmEntries.push({ t: now, tokens });
        tpmWindows.set(key, tpmEntries);
        recordDailyTokens(key, tokens);
      }
      return;
    }

    let waitMs = 500;
    if (rpmFull && timestamps.length) {
      waitMs = Math.max(waitMs, timestamps[0] + RPM_WINDOW_MS - now + 25);
    }
    if (tpmFull && tpmEntries.length) {
      waitMs = Math.max(waitMs, tpmEntries[0].t + RPM_WINDOW_MS - now + 25);
    } else if (tpmFull && tokens <= (limits.tpm ?? Infinity)) {
      // Sliding window should free capacity; avoid a tight spin if timestamps are empty.
      waitMs = Math.max(waitMs, RPM_WINDOW_MS);
    }
    if (rpdFull || tpdFull) {
      const nextDay = new Date();
      nextDay.setUTCHours(24, 0, 0, 0);
      waitMs = Math.max(waitMs, nextDay.getTime() - now);
    }

    waitMs = Math.min(waitMs, 60_000);
    const limitType = rpmFull
      ? "rpm"
      : rpdFull
        ? "rpd"
        : tpmFull
          ? "tpm"
          : "tpd";
    const reason =
      (rpmFull ? `RPM ${limits.rpm}` : "") +
      (rpdFull ? ` RPD ${limits.rpd}` : "") +
      (tpmFull ? ` TPM ${limits.tpm} (need ${tokens})` : "") +
      (tpdFull ? ` TPD ${limits.tpd}` : "");
    console.warn(
      `[llm-rate-limit] ${providerId}/${normalizeModelId(model) || "default"}: ` +
        `waiting ${Math.ceil(waitMs / 1000)}s` +
        (rpmFull ? ` (RPM ${limits.rpm})` : "") +
        (rpdFull ? ` (RPD ${limits.rpd})` : "") +
        (tpmFull ? ` (TPM ${limits.tpm}, need ${tokens})` : "") +
        (tpdFull ? ` (TPD ${limits.tpd})` : ""),
    );
    await sleepWithRateLimitNotify(waitMs, {
      providerId,
      model,
      limitType,
      reason: reason.trim(),
    });
  }
}

function isRetryableStatus(status) {
  return RETRYABLE_STATUSES.has(status);
}

/** Reset in-memory counters (tests only). */
export function resetLlmRateLimitState() {
  rpmWindows.clear();
  dailyRequestCounts.clear();
  tpmWindows.clear();
  dailyTokenCounts.clear();
  groqLiveByProvider.clear();
}

function formatFetchError(error, { providerId, model, url }) {
  const cause = error?.cause;
  const code = cause?.code ?? error?.code;
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();

  const hints = {
    local:
      "Is llama-server or Ollama running? Default: http://localhost:11434/v1",
    gemini: `Check internet access to ${host} and your Gemini API key in Settings.`,
    groq: `Check internet access to ${host} and your Groq API key.`,
    openrouter: `Check internet access to ${host} and your OpenRouter key.`,
    cerebras: `Check internet access to ${host} and your Cerebras key.`,
    openai: `Check internet access to ${host} and your OpenAI key.`,
    custom: `Check internet access to ${host} and your API key.`,
  };

  const parts = [
    `LLM network error (${providerId}/${normalizeModelId(model) || "default"} → ${host})`,
    error?.message ?? "fetch failed",
  ];
  if (code) parts.push(`[${code}]`);
  parts.push(hints[providerId] ?? hints.custom);
  return parts.join(" — ");
}

/**
 * fetch() wrapper: proactive throttle + exponential backoff on 429/503.
 * Retries do not consume additional RPM/TPM slots.
 */
export async function fetchLlmWithRateLimit(url, init, { providerId, model }) {
  const estimatedTokens = estimateRequestTokens(init);
  await acquireLlmRateLimitSlot({ providerId, model, estimatedTokens });

  const maxRetries = config.llm.rateLimit?.maxRetries ?? 5;
  let attempt = 0;

  while (true) {
    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      const wrapped = new Error(
        formatFetchError(error, { providerId, model, url }),
      );
      wrapped.cause = error;
      throw wrapped;
    }

    ingestGroqRateLimitHeaders(providerId, response.headers);

    if (!isRetryableStatus(response.status) || attempt >= maxRetries) {
      return response;
    }

    const delayMs = computeRetryDelayMs(
      attempt,
      response.headers.get("retry-after"),
    );
    console.warn(
      `[llm-rate-limit] ${providerId} HTTP ${response.status} — ` +
        `retry ${attempt + 1}/${maxRetries} in ${Math.ceil(delayMs / 1000)}s`,
    );
    await response.text().catch(() => "");
    await sleepWithRateLimitNotify(delayMs, {
      providerId,
      limitType: "retry",
      reason: `HTTP ${response.status}`,
    });
    attempt += 1;
  }
}
