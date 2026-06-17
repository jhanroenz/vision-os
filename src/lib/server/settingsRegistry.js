import path from "node:path";
import { applyProviderDefaults } from "./llmProviders.js";
import { defaultWorkspaceDir, resolveDataDir } from "./paths.js";

export const SETTING_SECTIONS = [
  "llm",
  "workspace",
  "search",
  "context",
  "agent",
  "evolution",
  "codeQuality",
  "semanticSearch",
  "transcripts",
  "advanced",
];

const llmPreset = applyProviderDefaults("local");

/** @type {Array<{ key: string, section: string, path: string[], type: string, default: unknown, label: string, description?: string, restartRequired?: boolean, secret?: boolean, min?: number, max?: number, options?: string[] }>} */
export const SETTING_FIELDS = [
  // --- llm ---
  { key: "provider", section: "llm", path: ["llm", "provider"], type: "string", default: "local", label: "Provider" },
  { key: "baseURL", section: "llm", path: ["llm", "baseURL"], type: "string", default: llmPreset?.baseURL ?? "http://localhost:11434/v1", label: "Base URL" },
  { key: "model", section: "llm", path: ["llm", "model"], type: "string", default: llmPreset?.model ?? "gemma-4-E2B-it-Q4_K_M.gguf", label: "Model" },
  { key: "context", section: "llm", path: ["llm", "context"], type: "number", default: 131072, label: "Context window", min: 1024, max: 2_000_000 },
  { key: "temperature", section: "llm", path: ["llm", "temperature"], type: "number", default: 0.2, label: "Temperature", min: 0, max: 2 },
  { key: "slotsEnabled", section: "llm", path: ["llm", "slotsEnabled"], type: "boolean", default: true, label: "KV slot persistence" },
  { key: "slotId", section: "llm", path: ["llm", "slotId"], type: "number", default: 0, label: "Slot ID", min: 0, max: 64 },
  { key: "streaming", section: "llm", path: ["llm", "streaming"], type: "boolean", default: true, label: "Streaming responses" },
  { key: "rateLimitEnabled", section: "llm", path: ["llm", "rateLimit", "enabled"], type: "boolean", default: true, label: "Rate limiting enabled" },
  { key: "rateLimitHeadroom", section: "llm", path: ["llm", "rateLimit", "headroom"], type: "boolean", default: true, label: "Rate limit safety headroom" },
  { key: "rateLimitMaxRetries", section: "llm", path: ["llm", "rateLimit", "maxRetries"], type: "number", default: 5, label: "Rate limit max retries", min: 0, max: 20 },
  { key: "rateLimitBaseBackoffMs", section: "llm", path: ["llm", "rateLimit", "baseBackoffMs"], type: "number", default: 1000, label: "Rate limit base backoff (ms)", min: 100, max: 60000 },
  { key: "rateLimitMaxBackoffMs", section: "llm", path: ["llm", "rateLimit", "maxBackoffMs"], type: "number", default: 120000, label: "Rate limit max backoff (ms)", min: 1000, max: 600000 },
  // --- workspace ---
  { key: "workspaceDir", section: "workspace", path: ["workspaceDir"], type: "string", default: defaultWorkspaceDir(resolveDataDir()), label: "Workspace directory", restartRequired: true },
  { key: "fileMapMaxDepth", section: "workspace", path: ["workspaceFileMap", "maxDepth"], type: "number", default: 12, label: "File map max depth", min: 1, max: 32 },
  { key: "fileMapMaxFiles", section: "workspace", path: ["workspaceFileMap", "maxFiles"], type: "number", default: 500, label: "File map max files", min: 50, max: 5000 },
  { key: "fileMapMaxChars", section: "workspace", path: ["workspaceFileMap", "maxChars"], type: "number", default: 12000, label: "File map max chars", min: 1000, max: 100000 },
  // --- search ---
  { key: "searxngApiBase", section: "search", path: ["searxng", "apiBase"], type: "string", default: "http://localhost:8080", label: "SearXNG API base URL" },
  { key: "searxngNumResults", section: "search", path: ["searxng", "numResults"], type: "number", default: 5, label: "SearXNG results per search", min: 1, max: 50 },
  { key: "searxngCategories", section: "search", path: ["searxng", "categories"], type: "string", default: "general", label: "SearXNG categories" },
  { key: "searxngAllowedEngines", section: "search", path: ["searxng", "allowedEngines"], type: "stringList", default: ["google", "bing", "brave", "duckduckgo", "startpage", "qwant", "mojeek"], label: "Allowed engines (comma-separated)" },
  { key: "searxngUseFixedEngines", section: "search", path: ["searxng", "useFixedEnginesWhenUnspecified"], type: "boolean", default: false, label: "Use fixed engines when unspecified" },
  { key: "searxngDefaultEngines", section: "search", path: ["searxng", "defaultEngines"], type: "string", default: "", label: "Default engines (comma-separated)" },
  { key: "searxngLanguage", section: "search", path: ["searxng", "language"], type: "string", default: "", label: "SearXNG language" },
  { key: "searxngSafesearch", section: "search", path: ["searxng", "safesearch"], type: "number", default: 0, label: "SearXNG safesearch", min: 0, max: 2 },
  { key: "webSearchMaxPerTurn", section: "search", path: ["searxng", "maxPerTurn"], type: "number", default: 1, label: "Web searches per turn", min: 0, max: 10 },
  { key: "webSearchAutoSaveToBrain", section: "search", path: ["searxng", "autoSaveToBrain"], type: "boolean", default: true, label: "Auto-save web answers to brain" },
  { key: "webSearchBrainRecallBeforeSearch", section: "search", path: ["searxng", "brainRecallBeforeSearch"], type: "boolean", default: true, label: "Recall brain before web search" },
  { key: "webSearchBrainRecallMinScore", section: "search", path: ["searxng", "brainRecallMinScore"], type: "number", default: 0.32, label: "Brain recall min score", min: 0, max: 1 },
  { key: "deepResearchSearchTimeoutMs", section: "search", path: ["deepResearch", "searchTimeoutMs"], type: "number", default: 12000, label: "Deep research search timeout (ms)", min: 1000, max: 120000 },
  { key: "deepResearchFetchConcurrency", section: "search", path: ["deepResearch", "fetchConcurrency"], type: "number", default: 3, label: "Deep research fetch concurrency", min: 1, max: 10 },
  { key: "deepResearchSynthesisMaxTokens", section: "search", path: ["deepResearch", "synthesisMaxTokens"], type: "number", default: 4096, label: "Deep research synthesis max tokens", min: 512, max: 32000 },
  { key: "deepResearchEnginesPerSearch", section: "search", path: ["deepResearch", "enginesPerSearch"], type: "number", default: 2, label: "Engines per research search", min: 1, max: 5 },
  { key: "deepResearchSupplementalEngineSearch", section: "search", path: ["deepResearch", "supplementalEngineSearch"], type: "boolean", default: true, label: "Supplemental engine search" },
  // --- context ---
  { key: "contextReserve", section: "context", path: ["llm", "contextReserve"], type: "number", default: 4096, label: "Context reserve tokens", min: 512, max: 32000 },
  { key: "compactKeepRecent", section: "context", path: ["llm", "compactKeepRecent"], type: "number", default: 6, label: "Messages kept when compacting", min: 2, max: 32 },
  { key: "autoCompactPercent", section: "context", path: ["llm", "autoCompactPercent"], type: "number", default: 60, label: "Auto-compact at % context", min: 30, max: 95 },
  { key: "minifyEnabled", section: "context", path: ["minify", "enabled"], type: "boolean", default: true, label: "Minify tool results" },
  { key: "minifyFileReadMaxChars", section: "context", path: ["minify", "fileReadMaxChars"], type: "number", default: 12000, label: "Max chars per file read", min: 1000, max: 200000 },
  { key: "minifyAssistantMaxChars", section: "context", path: ["minify", "assistantMaxChars"], type: "number", default: 4000, label: "Max assistant message chars", min: 500, max: 50000 },
  { key: "minifyBashMaxChars", section: "context", path: ["minify", "bashMaxChars"], type: "number", default: 1500, label: "Max bash output chars", min: 200, max: 20000 },
  { key: "fileReadMaxBytes", section: "context", path: ["fileRead", "maxBytes"], type: "number", default: 512000, label: "File read max bytes", min: 4096, max: 5000000 },
  // --- agent ---
  { key: "loopV2", section: "agent", path: ["agent", "loopV2"], type: "boolean", default: true, label: "Token-efficient agent loop (v2)" },
  { key: "promptCompactMode", section: "agent", path: ["prompt", "compactMode"], type: "boolean", default: true, label: "Compact system prompt" },
  { key: "requireWebResearchForCoding", section: "agent", path: ["agent", "requireWebResearchForCoding"], type: "boolean", default: false, label: "Require web research before coding" },
  { key: "turnIntentLlm", section: "agent", path: ["agent", "turnIntentLlm"], type: "boolean", default: true, label: "LLM turn intent classification" },
  { key: "intentAssessmentLlm", section: "agent", path: ["agent", "intentAssessmentLlm"], type: "boolean", default: false, label: "LLM intent assessment" },
  { key: "acceptanceCriteriaLlm", section: "agent", path: ["agent", "acceptanceCriteriaLlm"], type: "boolean", default: false, label: "LLM acceptance criteria synthesis" },
  { key: "verificationPlanningLlm", section: "agent", path: ["agent", "verificationPlanningLlm"], type: "boolean", default: false, label: "LLM verification planning" },
  { key: "nextMovePlanningLlm", section: "agent", path: ["agent", "nextMovePlanningLlm"], type: "boolean", default: false, label: "LLM next-move planning" },
  { key: "toolGuidanceEnabled", section: "agent", path: ["agent", "toolGuidanceEnabled"], type: "boolean", default: false, label: "Per-tool guidance in system prompt" },
  { key: "toolParallelEnabled", section: "agent", path: ["toolParallel", "enabled"], type: "boolean", default: true, label: "Parallel read-only tools" },
  { key: "toolParallelConcurrency", section: "agent", path: ["toolParallel", "concurrency"], type: "number", default: 4, label: "Parallel tool concurrency", min: 1, max: 16 },
  // --- evolution ---
  { key: "promptMaxMemories", section: "evolution", path: ["evolution", "promptMaxMemories"], type: "number", default: 5, label: "Pinned memories in prompt", min: 0, max: 20 },
  { key: "promptMaxSkills", section: "evolution", path: ["evolution", "promptMaxSkills"], type: "number", default: 3, label: "Pinned skills in prompt", min: 0, max: 10 },
  { key: "promptMinImportance", section: "evolution", path: ["evolution", "promptMinImportance"], type: "number", default: 4, label: "Min importance for prompt index", min: 1, max: 5 },
  { key: "recallMaxResults", section: "evolution", path: ["evolution", "recallMaxResults"], type: "number", default: 8, label: "recall_brain max results", min: 1, max: 32 },
  { key: "autoReflect", section: "evolution", path: ["evolution", "autoReflect"], type: "boolean", default: true, label: "Auto-reflect after turns" },
  { key: "autoReflectMinTurns", section: "evolution", path: ["evolution", "autoReflectMinTurns"], type: "number", default: 2, label: "Min turns before auto-reflect", min: 1, max: 50 },
  { key: "failureCaptureEnabled", section: "evolution", path: ["evolution", "failureCaptureEnabled"], type: "boolean", default: true, label: "Capture failure lessons" },
  { key: "brainSemanticEnabled", section: "evolution", path: ["evolution", "brainSemantic", "enabled"], type: "boolean", default: true, label: "Brain semantic recall" },
  { key: "brainSemanticMinScore", section: "evolution", path: ["evolution", "brainSemantic", "minScore"], type: "number", default: 0.2, label: "Brain semantic min score", min: 0, max: 1 },
  { key: "compressOnSave", section: "evolution", path: ["evolution", "compressOnSave"], type: "boolean", default: true, label: "Compress memories on save" },
  // --- codeQuality ---
  { key: "syntaxEnabled", section: "codeQuality", path: ["codeCheck", "syntaxEnabled"], type: "boolean", default: true, label: "Syntax checking enabled" },
  { key: "astReadGateEnabled", section: "codeQuality", path: ["astReadGate", "enabled"], type: "boolean", default: true, label: "AST read gate" },
  { key: "astReadRedirect", section: "codeQuality", path: ["astReadGate", "redirectToInspect"], type: "boolean", default: true, label: "Redirect read_file to inspect_ast" },
  { key: "astMaxNodes", section: "codeQuality", path: ["astInspect", "maxNodes"], type: "number", default: 80, label: "AST max nodes", min: 10, max: 500 },
  { key: "astMaxDepth", section: "codeQuality", path: ["astInspect", "maxDepth"], type: "number", default: 6, label: "AST max depth", min: 1, max: 20 },
  // --- semanticSearch ---
  { key: "semanticSearchEnabled", section: "semanticSearch", path: ["semanticSearch", "enabled"], type: "boolean", default: true, label: "Semantic codebase search", restartRequired: true },
  { key: "semanticSearchModel", section: "semanticSearch", path: ["semanticSearch", "model"], type: "string", default: "Xenova/all-MiniLM-L6-v2", label: "Semantic search model", restartRequired: true },
  { key: "semanticSearchMaxResults", section: "semanticSearch", path: ["semanticSearch", "maxResults"], type: "number", default: 8, label: "Semantic search max results", min: 1, max: 50 },
  { key: "semanticSearchMaxFiles", section: "semanticSearch", path: ["semanticSearch", "maxFilesPerIndex"], type: "number", default: 2500, label: "Max files per index", min: 100, max: 10000 },
  // --- transcripts ---
  { key: "transcriptLogEnabled", section: "transcripts", path: ["transcript", "enabled"], type: "boolean", default: true, label: "Transcript logging" },
  { key: "transcriptMaxFieldChars", section: "transcripts", path: ["transcript", "maxFieldChars"], type: "number", default: 0, label: "Transcript max field chars (0=unlimited)", min: 0, max: 1000000 },
  // --- advanced ---
  { key: "intentClassifierMode", section: "advanced", path: ["intentClassifier", "mode"], type: "string", default: "auto", label: "Intent classifier mode", options: ["auto", "llm", "zero-shot"] },
  { key: "intentZeroshotThreshold", section: "advanced", path: ["intentClassifier", "zeroshotThreshold"], type: "number", default: 0.38, label: "Zero-shot threshold", min: 0, max: 1 },
  { key: "searxngFetchMaxChars", section: "advanced", path: ["searxng", "fetchMaxChars"], type: "number", default: 20000, label: "SearXNG fetch max chars", min: 1000, max: 100000 },
  { key: "searxngFetchConcurrency", section: "advanced", path: ["searxng", "fetchConcurrency"], type: "number", default: 3, label: "SearXNG fetch concurrency", min: 1, max: 10 },
];

const fieldsBySection = Object.groupBy(SETTING_FIELDS, (f) => f.section);

export function getFieldsForSection(section) {
  return fieldsBySection[section] ?? [];
}

function getAtPath(obj, pathParts) {
  let cur = obj;
  for (const p of pathParts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setAtPath(obj, pathParts, value) {
  let cur = obj;
  for (let i = 0; i < pathParts.length - 1; i++) {
    const p = pathParts[i];
    if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[pathParts[pathParts.length - 1]] = value;
}

function coerceValue(field, raw) {
  if (raw === null || raw === undefined) return field.default;
  switch (field.type) {
    case "boolean":
      return Boolean(raw);
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`${field.label} must be a number`);
      if (field.min != null && n < field.min) throw new Error(`${field.label} must be ≥ ${field.min}`);
      if (field.max != null && n > field.max) throw new Error(`${field.label} must be ≤ ${field.max}`);
      return Number.isInteger(field.default) && Number.isInteger(n)
        ? Math.floor(n)
        : n;
    }
    case "stringList": {
      if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
      return String(raw)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    }
    case "string":
    default: {
      const s = String(raw ?? "").trim();
      if (field.options && s && !field.options.includes(s)) {
        throw new Error(`${field.label} must be one of: ${field.options.join(", ")}`);
      }
      return s;
    }
  }
}

export function getCodeDefaultsBySection() {
  const out = {};
  for (const section of SETTING_SECTIONS) {
    out[section] = {};
    for (const field of getFieldsForSection(section)) {
      out[section][field.key] = structuredClone(field.default);
    }
  }
  return out;
}

export function extractSectionFromConfig(config, section) {
  const out = {};
  for (const field of getFieldsForSection(section)) {
    let val = getAtPath(config, field.path);
    if (field.type === "stringList" && Array.isArray(val)) {
      val = val.join(", ");
    }
    out[field.key] = val ?? field.default;
  }
  return out;
}

export function extractAllSectionsFromConfig(config) {
  const out = {};
  for (const section of SETTING_SECTIONS) {
    out[section] = extractSectionFromConfig(config, section);
  }
  return out;
}

export function validateSectionPatch(section, patch) {
  if (!patch || typeof patch !== "object") return {};
  const result = {};
  const fieldMap = new Map(getFieldsForSection(section).map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(patch)) {
    const field = fieldMap.get(key);
    if (!field) continue;
    if (field.secret) continue;
    result[key] = coerceValue(field, value);
  }
  return result;
}

export function applySectionToConfig(config, section, values) {
  for (const field of getFieldsForSection(section)) {
    if (!(field.key in values)) continue;
    let val = values[field.key];
    if (field.type === "stringList") {
      val = coerceValue(field, val);
      setAtPath(config, field.path, val);
    } else {
      setAtPath(config, field.path, coerceValue(field, val));
    }
  }
}

export function applySettingsOverlay(config, payload) {
  if (!payload || typeof payload !== "object") return;
  for (const section of SETTING_SECTIONS) {
    const sectionData = payload[section];
    if (sectionData && typeof sectionData === "object") {
      applySectionToConfig(config, section, sectionData);
    }
  }
}

export function mergeSectionPayload(current, patch) {
  return { ...current, ...patch };
}

export function getRestartRequiredSections(payload, previousPayload) {
  const sections = new Set();
  for (const field of SETTING_FIELDS) {
    if (!field.restartRequired) continue;
    const prev = previousPayload?.[field.section]?.[field.key];
    const next = payload?.[field.section]?.[field.key];
    if (next !== undefined && prev !== next) sections.add(field.section);
  }
  return [...sections];
}

export function getSectionMeta(section) {
  return getFieldsForSection(section).map((f) => ({
    key: f.key,
    label: f.label,
    description: f.description,
    type: f.type,
    default: f.default,
    min: f.min,
    max: f.max,
    options: f.options,
    restartRequired: Boolean(f.restartRequired),
  }));
}
