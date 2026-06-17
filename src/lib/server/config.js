import path from "node:path";
import {
  resolveDataDir,
  resolveVisionRoot,
  resolveWorkspaceDir,
} from "./paths.js";
import { PACKAGED_PORTS, packagedSearxngBase } from "./ports.js";
import { loadVisionEnv } from "./dotenvLoad.js";

loadVisionEnv();

const rootDir = resolveVisionRoot();
const dataDir = resolveDataDir();

export const config = {
  llm: {
    provider: process.env.LLM_PROVIDER ?? "local",
    baseURL: process.env.LLM_BASE_URL ?? "http://localhost:11434/v1",
    model: process.env.LLM_MODEL ?? "gemma-4-E2B-it-Q4_K_M.gguf",
    context: Number(process.env.LLM_CONTEXT ?? 131072),
    apiKey:
      process.env.LLM_API_KEY ??
      process.env.GROQ_API_KEY ??
      process.env.OPENROUTER_API_KEY ??
      process.env.GEMINI_API_KEY ??
      process.env.GOOGLE_API_KEY ??
      process.env.OPENAI_API_KEY ??
      "not-needed",
    /** @type {Record<string, string>} Saved API keys per provider id (from settings.json). */
    apiKeys: {},
    temperature: Number(process.env.LLM_TEMPERATURE ?? 0.2),
    contextReserve: Number(process.env.CONTEXT_RESERVE_TOKENS ?? 4096),
    compactKeepRecent: Number(process.env.COMPACT_KEEP_RECENT ?? 6),
    autoCompactPercent: Number(process.env.AUTO_COMPACT_PERCENT ?? 60),
    slotsEnabled: process.env.LLM_SLOTS_ENABLED !== "false",
    slotId: Number(process.env.LLM_SLOT_ID ?? 0),
    streaming: process.env.LLM_STREAMING !== "false",
    rateLimit: {
      enabled: process.env.LLM_RATE_LIMIT_ENABLED !== "false",
      /** When true, effective caps are below configured tier limits. */
      headroom: process.env.LLM_RATE_LIMIT_HEADROOM !== "false",
      rpm: process.env.LLM_RATE_LIMIT_RPM
        ? Number(process.env.LLM_RATE_LIMIT_RPM)
        : null,
      rpd: process.env.LLM_RATE_LIMIT_RPD
        ? Number(process.env.LLM_RATE_LIMIT_RPD)
        : null,
      tpm: process.env.LLM_RATE_LIMIT_TPM
        ? Number(process.env.LLM_RATE_LIMIT_TPM)
        : null,
      tpd: process.env.LLM_RATE_LIMIT_TPD
        ? Number(process.env.LLM_RATE_LIMIT_TPD)
        : null,
      /** @type {Record<string, { rpm?: number | null, rpd?: number | null, tpm?: number | null, tpd?: number | null }>} */
      providers: {},
      /** @type {Record<string, { rpm?: number | null, rpd?: number | null, tpm?: number | null, tpd?: number | null }>} */
      models: {},
      maxRetries: Number(process.env.LLM_RATE_LIMIT_MAX_RETRIES ?? 5),
      baseBackoffMs: Number(process.env.LLM_RATE_LIMIT_BACKOFF_MS ?? 1000),
      maxBackoffMs: Number(process.env.LLM_RATE_LIMIT_MAX_BACKOFF_MS ?? 120000),
    },
  },
  minify: {
    enabled: process.env.MINIFY_ENABLED !== "false",
    searchMaxResults: Number(process.env.MINIFY_SEARCH_MAX_RESULTS ?? 5),
    searchSnippetChars: Number(process.env.MINIFY_SEARCH_SNIPPET_CHARS ?? 500),
    searchMaxChars: Number(process.env.MINIFY_SEARCH_MAX_CHARS ?? 2000),
    fileReadMaxChars: Number(process.env.MINIFY_FILE_READ_MAX_CHARS ?? 12000),
    fileReadHeadLines: Number(process.env.MINIFY_FILE_READ_HEAD_LINES ?? 40),
    fileReadTailLines: Number(process.env.MINIFY_FILE_READ_TAIL_LINES ?? 15),
    listDirMaxChars: Number(process.env.MINIFY_LIST_DIR_MAX_CHARS ?? 3000),
    bashMaxChars: Number(process.env.MINIFY_BASH_MAX_CHARS ?? 1500),
    assistantMaxChars: Number(process.env.MINIFY_ASSISTANT_MAX_CHARS ?? 4000),
    defaultMaxChars: Number(process.env.MINIFY_DEFAULT_MAX_CHARS ?? 2000),
    transcriptMaxChars: Number(process.env.MINIFY_TRANSCRIPT_MAX_CHARS ?? 1200),
  },
  dbPath: path.resolve(
    process.env.DATABASE_PATH ?? path.join(dataDir, "jarvis.db"),
  ),
  conversationsDir: path.resolve(
    process.env.CONVERSATIONS_DIR ??
      path.join(dataDir, "conversations"),
  ),
  workspaceDir: resolveWorkspaceDir(dataDir),
  workspaceFileMap: {
    maxDepth: Number(process.env.WORKSPACE_FILE_MAP_MAX_DEPTH ?? 12),
    maxFiles: Number(process.env.WORKSPACE_FILE_MAP_MAX_FILES ?? 500),
    maxChars: Number(process.env.WORKSPACE_FILE_MAP_MAX_CHARS ?? 12000),
  },
  port: Number(
    process.env.PORT ??
      (process.env.VISIONOS_PACKAGED === "true" ? PACKAGED_PORTS.backend : 5173),
  ),
  prompt: {
    compactMode: process.env.PROMPT_COMPACT_MODE !== "false",
  },
  agent: {
    loopV2: process.env.AGENT_LOOP_V2 !== "false",
    requireWebResearchForCoding:
      process.env.AGENT_REQUIRE_WEB_RESEARCH === "true",
    turnIntentLlm: process.env.TURN_INTENT_LLM !== "false",
    turnIntentMaxTokens: Number(process.env.TURN_INTENT_MAX_TOKENS ?? 256),
    intentAssessmentEnabled: process.env.INTENT_ASSESSMENT_ENABLED !== "false",
    intentAssessmentLlm: process.env.INTENT_ASSESSMENT_LLM === "true",
    intentAssessmentMaxTokens: Number(
      process.env.INTENT_ASSESSMENT_MAX_TOKENS ?? 256,
    ),
    intentAssessmentHeuristicFirst:
      process.env.INTENT_ASSESSMENT_HEURISTIC_FIRST !== "false",
    nextMovePlanningEnabled: process.env.NEXT_MOVE_PLANNING_ENABLED !== "false",
    nextMovePlanningLlm: process.env.NEXT_MOVE_PLANNING_LLM === "true",
    nextMovePlanningMaxTokens: Number(
      process.env.NEXT_MOVE_PLANNING_MAX_TOKENS ?? 384,
    ),
    verificationPlanningEnabled:
      process.env.VERIFICATION_PLANNING_ENABLED !== "false",
    verificationPlanningLlm: process.env.VERIFICATION_PLANNING_LLM === "true",
    verificationPlanningMaxTokens: Number(
      process.env.VERIFICATION_PLANNING_MAX_TOKENS ?? 512,
    ),
    acceptanceCriteriaEnabled:
      process.env.ACCEPTANCE_CRITERIA_ENABLED !== "false",
    acceptanceCriteriaLlm: process.env.ACCEPTANCE_CRITERIA_LLM === "true",
    acceptanceCriteriaMaxTokens: Number(
      process.env.ACCEPTANCE_CRITERIA_MAX_TOKENS ?? 384,
    ),
    toolGuidanceEnabled: process.env.TOOL_GUIDANCE_ENABLED === "true",
  },
  intentClassifier: {
    /** llm | zero-shot | auto (LLM then zero-shot fallback) */
    mode:
      process.env.INTENT_CLASSIFIER ??
      (process.env.TURN_INTENT_LLM === "false" ? "zero-shot" : "auto"),
    zeroshotModel:
      process.env.INTENT_ZEROSHOT_MODEL ?? "Xenova/mobilebert-uncased-mnli",
    zeroshotThreshold: Number(process.env.INTENT_ZEROSHOT_THRESHOLD ?? 0.38),
    llmMaxTokens: Number(
      process.env.INTENT_LLM_MAX_TOKENS ??
        process.env.TURN_INTENT_MAX_TOKENS ??
        256,
    ),
  },
  semanticSearch: {
    enabled: process.env.SEMANTIC_SEARCH_ENABLED !== "false",
    model:
      process.env.SEMANTIC_SEARCH_MODEL ?? "Xenova/all-MiniLM-L6-v2",
    maxResults: Number(process.env.SEMANTIC_SEARCH_MAX_RESULTS ?? 8),
    maxFileSize: Number(process.env.SEMANTIC_SEARCH_MAX_FILE_SIZE ?? 524288),
    maxFilesPerIndex: Number(process.env.SEMANTIC_SEARCH_MAX_FILES ?? 2500),
  },
  evolution: {
    /** Max memories injected as pinned index in system prompt */
    promptMaxMemories: Number(process.env.EVOLUTION_PROMPT_MAX_MEMORIES ?? 5),
    /** Max skills injected as pinned index in system prompt */
    promptMaxSkills: Number(process.env.EVOLUTION_PROMPT_MAX_SKILLS ?? 3),
    /** Only memories at or above this importance appear in the pinned prompt index */
    promptMinImportance: Number(process.env.EVOLUTION_PROMPT_MIN_IMPORTANCE ?? 4),
    /** Max results returned by recall_brain per search */
    recallMaxResults: Number(process.env.EVOLUTION_RECALL_MAX_RESULTS ?? 8),
    /** @deprecated use promptMaxMemories — kept for backward compat reads */
    maxMemories: Number(
      process.env.EVOLUTION_MAX_MEMORIES ??
        process.env.EVOLUTION_PROMPT_MAX_MEMORIES ??
        5,
    ),
    /** @deprecated use promptMaxSkills */
    maxSkills: Number(
      process.env.EVOLUTION_MAX_SKILLS ??
        process.env.EVOLUTION_PROMPT_MAX_SKILLS ??
        3,
    ),
    memoryMaxChars: Number(process.env.EVOLUTION_MEMORY_MAX_CHARS ?? 300),
    skillMaxChars: Number(process.env.EVOLUTION_SKILL_MAX_CHARS ?? 500),
    reflectTurns: Number(process.env.EVOLUTION_REFLECT_TURNS ?? 12),
    reflectMaxMemories: Number(process.env.EVOLUTION_REFLECT_MAX_MEMORIES ?? 3),
    reflectMaxSkills: Number(process.env.EVOLUTION_REFLECT_MAX_SKILLS ?? 2),
    reflectMinImportance: Number(process.env.EVOLUTION_REFLECT_MIN_IMPORTANCE ?? 4),
    autoReflect: process.env.EVOLUTION_AUTO_REFLECT !== "false",
    autoReflectMinTurns: Number(process.env.EVOLUTION_AUTO_REFLECT_MIN_TURNS ?? 2),
    autoReflectDebounceMs: Number(
      process.env.EVOLUTION_AUTO_REFLECT_DEBOUNCE_MS ?? 300000,
    ),
    failureCaptureEnabled: process.env.FAILURE_CAPTURE_ENABLED !== "false",
    failurePromptMax: Number(process.env.FAILURE_PROMPT_MAX ?? 3),
    failurePromptMinScore: Number(process.env.FAILURE_PROMPT_MIN_SCORE ?? 0.35),
    failurePreToolMinScore: Number(process.env.FAILURE_PRETOOL_MIN_SCORE ?? 0.55),
    brainSemantic: {
      enabled: process.env.BRAIN_SEMANTIC_ENABLED !== "false",
      model:
        process.env.BRAIN_SEMANTIC_MODEL ??
        process.env.SEMANTIC_SEARCH_MODEL ??
        "Xenova/all-MiniLM-L6-v2",
      minScore: Number(process.env.BRAIN_SEMANTIC_MIN_SCORE ?? 0.2),
    },
    compressOnSave: process.env.EVOLUTION_COMPRESS_ON_SAVE !== "false",
    compressStyle:
      process.env.EVOLUTION_COMPRESS_STYLE ?? "telegraph",
    compressMaxChars: Number(process.env.EVOLUTION_COMPRESS_MAX_CHARS ?? 120),
  },
  codeCheck: {
    syntaxEnabled: process.env.CODE_CHECK_SYNTAX_ENABLED !== "false",
    maxFileBytes: Number(process.env.CODE_CHECK_MAX_FILE_BYTES ?? 524288),
  },
  astReadGate: {
    enabled: process.env.AST_READ_GATE_ENABLED !== "false",
    /** When true, read_file/read_files without prior inspect_ast runs inspect_ast instead of only blocking. */
    redirectToInspect: process.env.AST_READ_REDIRECT !== "false",
  },
  astInspect: {
    maxNodes: Number(process.env.AST_MAX_NODES ?? 80),
    maxDepth: Number(process.env.AST_MAX_DEPTH ?? 6),
    maxOutlineSymbols: Number(process.env.AST_MAX_OUTLINE_SYMBOLS ?? 60),
  },
  fileRead: {
    maxBytes: Number(process.env.FILE_READ_MAX_BYTES ?? 512000),
  },
  searxng: {
    apiBase:
      process.env.SEARXNG_API_BASE ??
      (process.env.VISIONOS_PACKAGED === "true" ? packagedSearxngBase() : "http://localhost:8080"),
    numResults: Number(process.env.SEARXNG_NUM_RESULTS ?? 5),
    fetchPages: Number(
      process.env.SEARXNG_FETCH_PAGES ?? process.env.SEARXNG_NUM_RESULTS ?? 5,
    ),
    fetchMaxChars: Number(process.env.SEARXNG_FETCH_MAX_CHARS ?? 20000),
    fetchConcurrency: Number(process.env.SEARXNG_FETCH_CONCURRENCY ?? 3),
    fetchTimeoutMs: Number(process.env.SEARXNG_FETCH_TIMEOUT_MS ?? 15000),
    maxPerTurn: Number(process.env.WEB_SEARCH_MAX_PER_TURN ?? 1),
    autoSaveToBrain: process.env.WEB_SEARCH_AUTO_SAVE_TO_BRAIN !== "false",
    brainRecallBeforeSearch:
      process.env.WEB_SEARCH_BRAIN_RECALL_BEFORE_SEARCH !== "false",
    brainRecallMinScore: Number(
      process.env.WEB_SEARCH_BRAIN_RECALL_MIN_SCORE ?? 0.32,
    ),
    categories: process.env.SEARXNG_CATEGORIES ?? "general",
    /** @deprecated alias — use defaultEngines; only applied when useFixedEnginesWhenUnspecified */
    engines: process.env.SEARXNG_ENGINES,
    defaultEngines: process.env.SEARXNG_ENGINES,
    allowedEngines: (process.env.SEARXNG_ALLOWED_ENGINES ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    useFixedEnginesWhenUnspecified:
      process.env.SEARXNG_USE_FIXED_ENGINES === "true",
    language: process.env.SEARXNG_LANGUAGE,
    safesearch: Number(process.env.SEARXNG_SAFESEARCH ?? 0),
    headers: {
      // Required when limiter/botdetection is active; harmless for local use.
      "X-Forwarded-For": "127.0.0.1",
      "X-Real-IP": "127.0.0.1",
      ...(process.env.SEARXNG_API_KEY
        ? { Authorization: `Bearer ${process.env.SEARXNG_API_KEY}` }
        : {}),
    },
  },
  deepResearch: {
    searchTimeoutMs: Number(process.env.DEEP_RESEARCH_SEARCH_TIMEOUT_MS ?? 12000),
    fetchConcurrency: Number(process.env.DEEP_RESEARCH_FETCH_CONCURRENCY ?? 3),
    synthesisMaxTokens: Number(process.env.DEEP_RESEARCH_SYNTHESIS_MAX_TOKENS ?? 4096),
    /** Comma-separated engines passed to each research search (rotates pairs). */
    enginesPerSearch: Number(process.env.DEEP_RESEARCH_ENGINES_PER_SEARCH ?? 2),
    supplementalEngineSearch:
      process.env.DEEP_RESEARCH_SUPPLEMENTAL_ENGINE_SEARCH !== "false",
  },
  toolParallel: {
    enabled: process.env.TOOL_PARALLEL_ENABLED !== "false",
    concurrency: Number(process.env.TOOL_PARALLEL_CONCURRENCY ?? 4),
  },
  transcript: {
    /** Full per-conversation debug logs (JSONL). */
    enabled: process.env.TRANSCRIPT_LOG_ENABLED !== "false",
    dir: path.resolve(
      process.env.TRANSCRIPT_DIR ?? path.join(dataDir, "transcripts"),
    ),
    /** Max chars per string field; 0 = unlimited (recommended for debugging). */
    maxFieldChars: Number(process.env.TRANSCRIPT_MAX_FIELD_CHARS ?? 0),
  },
};
