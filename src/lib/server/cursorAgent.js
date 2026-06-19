import path from "node:path";
import { Agent, AgentBusyError, CursorAgentError } from "@cursor/sdk";
import { config } from "./config.js";
import {
  buildCursorModelSelection,
  isCursorComposerModel,
  resolveLlmApiKey,
} from "./llmProviders.js";
import {
  addUiMessage,
  saveConversation,
  setConversationCursorAgentId,
} from "./conversations.js";
import { getConversationWorkspaceRoot } from "./conversationWorkspace.js";
import { getConversationContext } from "./context.js";
import { getThreadCwd } from "./workspace.js";
import {
  buildCursorAppBuilderPrefix,
  shouldUseCursorAppBuilder,
  wasAppRegisteredInToolEvents,
} from "./userApps/cursorAppBuilder.js";
import {
  detectAppSourceFromToolEvents,
  parsePublishSlugFromShellCommand,
} from "./userApps/register.js";
import { getUserAppBySlug } from "./userApps/repository.js";
import { isAppBuilderComposerMode } from "./composerMode.js";

const ASK_MODE_PREFIX =
  "Read-only mode: answer questions and explore the codebase. Do not create, edit, or delete files unless the user explicitly asks.\n\n";

/** Keep SDK agents warm per conversation; disposing after every turn leaves stale active runs. */
const CURSOR_AGENT_TTL_MS = 30 * 60 * 1000;
/** @type {Map<string, { agent: import("@cursor/sdk").Agent, lastUsed: number }>} */
const cursorAgentPool = new Map();
/** Serialize Cursor turns per conversation (concurrent HTTP streams share one SDK agent). */
/** @type {Map<string, Promise<void>>} */
const cursorTurnTail = new Map();

export function isAgentBusyError(error) {
  if (error instanceof AgentBusyError) return true;
  return /already has active run/i.test(String(error?.message ?? ""));
}

function evictIdleCursorAgents() {
  const now = Date.now();
  for (const [conversationId, entry] of cursorAgentPool) {
    if (now - entry.lastUsed > CURSOR_AGENT_TTL_MS) {
      void disposeCursorAgent(entry.agent);
      cursorAgentPool.delete(conversationId);
    }
  }
}

async function invalidateCursorAgent(conversationId) {
  const entry = cursorAgentPool.get(conversationId);
  if (!entry) return;
  cursorAgentPool.delete(conversationId);
  await disposeCursorAgent(entry.agent);
}

async function expireActiveRun(agent) {
  if (typeof agent?.expireActiveRunForForceSend === "function") {
    await agent.expireActiveRunForForceSend();
  }
}

async function cancelRunIfPossible(run) {
  if (!run) return;
  try {
    if (typeof run.supports === "function" && run.supports("cancel")) {
      await run.cancel();
    }
  } catch {
    // ignore — expireActiveRun is the fallback
  }
}

export async function sendCursorPrompt(agent, prompt) {
  try {
    return await agent.send(prompt);
  } catch (error) {
    if (!isAgentBusyError(error)) throw error;
    await expireActiveRun(agent);
    return await agent.send(prompt);
  }
}

async function cleanupInterruptedCursorRun(agent, run, runFinished) {
  if (!run || runFinished) return;
  await cancelRunIfPossible(run);
  if (agent) await expireActiveRun(agent);
}

async function acquireCursorConversationLock(conversationId) {
  const key = String(conversationId);
  const previous = cursorTurnTail.get(key) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  cursorTurnTail.set(key, tail);
  await previous;
  return () => {
    release();
    if (cursorTurnTail.get(key) === tail) {
      cursorTurnTail.delete(key);
    }
  };
}

function freshCursorStreamState() {
  return {
    emittedToolCalls: new Set(),
    assistantText: "",
    lastError: "",
  };
}

/**
 * Map one Cursor SDK stream message to zero or more Jarvis SSE events.
 * @param {import("@cursor/sdk").SDKMessage} message
 * @param {{ emittedToolCalls: Set<string>, assistantText: string, lastError?: string }} state
 */
export function mapSdkMessageToJarvisEvents(message, state) {
  const events = [];

  if (message.type === "assistant") {
    const text = (message.message?.content ?? [])
      .filter((block) => block?.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    if (text) {
      const prev = state.assistantText.length;
      if (text.length > prev) {
        const delta = text.slice(prev);
        state.assistantText = text;
        events.push({ type: "message_delta", content: delta });
      } else if (!state.assistantText.includes(text)) {
        state.assistantText += text;
        events.push({ type: "message_delta", content: text });
      }
    }
    return events;
  }

  if (message.type === "thinking") {
    const chunk = String(message.text ?? "");
    if (chunk) {
      events.push({
        type: "reasoning_delta",
        step: 0,
        content: chunk,
        role: "assistant",
        modelLabel: "Cursor",
      });
    }
    return events;
  }

  if (message.type === "tool_call") {
    const callId = message.call_id ?? message.name;
    const toolName = normalizeCursorToolName(message.name);

    if (message.status === "running" && callId && !state.emittedToolCalls.has(callId)) {
      state.emittedToolCalls.add(callId);
      events.push({
        type: "tool_call",
        name: toolName,
        args: message.args ?? {},
        callId,
      });
      return events;
    }

    if (
      (message.status === "completed" || message.status === "error") &&
      callId
    ) {
      const { summary, displayText } = parseCursorToolResult(
        message.result,
        message.status,
      );
      events.push({
        type: "tool_result",
        name: toolName,
        content: displayText,
        resultSummary: summary,
        callId,
      });
    }
    return events;
  }

  if (message.type === "status") {
    if (message.status === "ERROR") {
      state.lastError = message.message || state.lastError || "Cursor agent error";
    }
    if (message.message) {
      events.push({
        type: "status",
        phase: "cursor",
        message: message.message,
      });
    }
    return events;
  }

  if (message.type === "task" && message.text) {
    events.push({
      type: "status",
      phase: "cursor-task",
      message: message.text,
    });
  }

  return events;
}

const CURSOR_TOOL_ALIASES = {
  glob: "glob_files",
  grep: "grep_code",
  read: "read_file",
  shell: "run_bash",
  write: "write_file",
  edit: "search_replace",
  ls: "list_directory",
  semsearch: "semantic_search",
};

export function normalizeCursorToolName(name) {
  const raw = String(name ?? "").trim().toLowerCase();
  return CURSOR_TOOL_ALIASES[raw] ?? raw;
}

/**
 * Cursor SDK tool results use { status, value }. Jarvis activity UI expects
 * resultSummary objects with a boolean `success` field.
 */
export function parseCursorToolResult(result, sdkStatus) {
  if (sdkStatus === "error") {
    return {
      summary: { success: false },
      displayText: formatCursorResultText(result) || "Tool call failed",
    };
  }

  if (result && typeof result === "object" && "status" in result) {
    const value = result.value ?? {};
    const summary = { success: result.status === "success" };

    if (value.exitCode != null) {
      summary.exitCode = Number(value.exitCode);
      summary.success = result.status === "success" && summary.exitCode === 0;
      const stdout = String(value.stdout ?? "");
      const stderr = String(value.stderr ?? "");
      summary.displayOutput = [stdout, stderr].filter(Boolean).join("\n").trim();
      summary.stderr = stderr;
    }

    if (Array.isArray(value.files)) {
      summary.fileCount = value.files.length;
      if (result.status === "success") summary.success = true;
    }

    if (result.status === "error") {
      summary.success = false;
    }

    return {
      summary,
      displayText: formatCursorResultText(result),
    };
  }

  const displayText = formatCursorResultText(result);
  return {
    summary: { success: sdkStatus === "completed" },
    displayText,
  };
}

function formatCursorResultText(result) {
  if (result == null) return "Done";
  if (typeof result === "string") return result.slice(0, 2000);
  if (typeof result !== "object") return String(result);

  if (result.status === "error") {
    const err =
      result.error?.message ??
      result.message ??
      result.value?.message ??
      result.value?.stderr;
    if (err) return String(err).slice(0, 2000);
  }

  const value = result.value;
  if (value && typeof value === "object") {
    if (value.stdout) return String(value.stdout).slice(0, 2000);
    if (Array.isArray(value.files)) {
      const n = value.files.length;
      const preview = value.files.slice(0, 5).join(", ");
      return n > 5 ? `Found ${n} files: ${preview}…` : `Found ${n} file(s): ${preview}`;
    }
    if (value.content != null) return String(value.content).slice(0, 2000);
    if (value.stderr) return String(value.stderr).slice(0, 2000);
  }

  try {
    return JSON.stringify(result).slice(0, 2000);
  } catch {
    return "Done";
  }
}

function summarizeToolResult(result, status) {
  return formatCursorResultText(
    status === "error" ? result : { status: status === "completed" ? "success" : status, value: result },
  );
}

function resolveCursorWorkspaceCwd(conversation) {
  const relative = getConversationWorkspaceRoot(conversation);
  return path.resolve(config.workspaceDir, relative);
}

function buildCursorPrompt(message, { askMode = false, composerMode = "chat" } = {}) {
  const text = String(message ?? "").trim();
  if (!text) throw new Error("Message is required");
  if (askMode) return `${ASK_MODE_PREFIX}${text}`;
  if (shouldUseCursorAppBuilder(text, composerMode, askMode)) {
    return `${buildCursorAppBuilderPrefix(text)}\n\nUser request:\n${text}`;
  }
  return text;
}

function buildLocalAgentOptions(cwd) {
  return {
    cwd,
    sandboxOptions: { enabled: false },
  };
}

async function acquireCursorAgent(conversation, apiKey, cwd, modelSelection) {
  const baseOptions = {
    apiKey,
    model: modelSelection,
    local: buildLocalAgentOptions(cwd),
  };

  const existingId = conversation.cursorAgentId;
  if (existingId) {
    try {
      return await Agent.resume(existingId, baseOptions);
    } catch (error) {
      console.warn(
        `[cursor] Failed to resume agent ${existingId}, creating new:`,
        error.message,
      );
      await invalidateCursorAgent(conversation.id);
    }
  }

  const agent = await Agent.create(baseOptions);
  await setConversationCursorAgentId(conversation.id, agent.agentId);
  conversation.cursorAgentId = agent.agentId;
  return agent;
}

async function getCursorAgent(conversation, apiKey, cwd, modelSelection) {
  evictIdleCursorAgents();

  const cached = cursorAgentPool.get(conversation.id);
  if (cached?.agent) {
    cached.lastUsed = Date.now();
    return cached.agent;
  }

  const agent = await acquireCursorAgent(conversation, apiKey, cwd, modelSelection);
  cursorAgentPool.set(conversation.id, { agent, lastUsed: Date.now() });
  return agent;
}

async function disposeCursorAgent(agent) {
  if (!agent) return;
  try {
    if (typeof agent[Symbol.asyncDispose] === "function") {
      await agent[Symbol.asyncDispose]();
      return;
    }
  } catch {
    // fall through to close
  }
  try {
    agent.close?.();
  } catch {
    // ignore
  }
}

async function formatCursorRunFailure(run, runResult, streamState, requestedModel) {
  const parts = [
    `Cursor agent run failed (${runResult.id ?? run.id ?? "unknown run"})`,
  ];

  if (streamState.lastError && streamState.lastError !== "Cursor agent error") {
    parts.push(streamState.lastError);
  } else if (runResult.result?.trim()) {
    parts.push(runResult.result.trim().slice(0, 500));
  }

  if (run.supports?.("conversation")) {
    try {
      const conv = await run.conversation();
      const tail = conv?.slice(-3) ?? [];
      for (const turn of tail) {
        const text =
          turn?.message?.content
            ?.filter((b) => b?.type === "text")
            .map((b) => b.text)
            .join("") ??
          turn?.text ??
          "";
        if (text) parts.push(text.slice(0, 500));
      }
    } catch {
      // ignore
    }
  }

  if (isCursorComposerModel(requestedModel)) {
    parts.push(
      "The composer-* model often fails via Cursor SDK local runtime. Set model to `auto` in Settings → LLM.",
    );
  }

  return parts.join(" — ");
}

class CursorRunFailedError extends Error {
  constructor(payload) {
    super("Cursor run failed");
    this.name = "CursorRunFailedError";
    this.payload = payload;
  }
}

async function* cursorAttemptStream({
  conversation,
  apiKey,
  cwd,
  modelSelection,
  prompt,
  toolEvents,
  streamState,
}) {
  let agent;
  let run = null;
  let runFinished = false;

  try {
    agent = await getCursorAgent(conversation, apiKey, cwd, modelSelection);
    run = await sendCursorPrompt(agent, prompt);

    for await (const sdkMessage of run.stream()) {
      for (const event of mapSdkMessageToJarvisEvents(sdkMessage, streamState)) {
        if (event.type === "tool_call" || event.type === "tool_result") {
          toolEvents.push(event);
        }
        yield event;
      }
    }

    const runResult = await run.wait();
    runFinished = true;

    if (runResult.status === "error") {
      throw new CursorRunFailedError({ run, runResult, streamState });
    }

    return {
      reply:
        runResult.result?.trim() ||
        streamState.assistantText.trim() ||
        "(no response)",
    };
  } finally {
    await cleanupInterruptedCursorRun(agent, run, runFinished);
  }
}

/**
 * Run one Agent/Ask turn via Cursor SDK (local runtime).
 */
export async function* streamCursorAgentTurn({
  message,
  threadId,
  conversation,
  askMode = false,
  composerMode = "chat",
}) {
  const apiKey = resolveLlmApiKey("cursor");
  if (!apiKey) {
    throw new Error(
      "No Cursor API key configured. Paste your key in Settings or set CURSOR_API_KEY in .env.",
    );
  }

  const appBuilderMode = isAppBuilderComposerMode(composerMode);
  const appBuilderFlow = shouldUseCursorAppBuilder(message, composerMode, askMode);
  const cwd = resolveCursorWorkspaceCwd(conversation);
  const prompt = buildCursorPrompt(message, { askMode, composerMode });
  const toolEvents = [];
  const requestedModel = config.llm.model;
  const modelSelection = buildCursorModelSelection(requestedModel);
  const effectiveModel = modelSelection.id;

  yield {
    type: "status",
    phase: appBuilderFlow ? "app-builder" : "cursor",
    message: appBuilderFlow
      ? "App Builder via Cursor Composer…"
      : "Running via Cursor Composer…",
  };

  yield {
    type: "turn_intent",
    profile: appBuilderFlow ? "appBuilder" : "chat",
    casualChat: false,
    source: appBuilderFlow ? "cursor-app-builder" : "cursor",
  };

  if (modelSelection._requested && modelSelection._requested !== effectiveModel) {
    yield {
      type: "status",
      phase: "cursor",
      message: `Using Cursor model "${effectiveModel}" (${modelSelection._requested} is not supported via SDK local runtime).`,
    };
  }

  const releaseLock = await acquireCursorConversationLock(conversation.id);
  const modelOpts = {
    id: effectiveModel,
    ...(modelSelection.params ? { params: modelSelection.params } : {}),
  };

  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const streamState = freshCursorStreamState();

      try {
        const attemptGen = cursorAttemptStream({
          conversation,
          apiKey,
          cwd,
          modelSelection: modelOpts,
          prompt,
          toolEvents,
          streamState,
        });

        let reply;
        while (true) {
          const step = await attemptGen.next();
          if (step.done) {
            reply = step.value?.reply;
            break;
          }
          yield step.value;
        }

        let finalReply = reply;
        if (appBuilderFlow) {
          let registeredSlug = null;
          for (const event of toolEvents) {
            const name = String(event?.name ?? "").toLowerCase();
            if (event.type === "tool_call" && (name === "run_bash" || name === "shell")) {
              const cmd = event.args?.command ?? event.args?.cmd ?? "";
              registeredSlug = parsePublishSlugFromShellCommand(cmd) ?? registeredSlug;
            }
          }
          const { existingSlug } = detectAppSourceFromToolEvents(toolEvents);
          const slug = registeredSlug ?? existingSlug;
          const registered = wasAppRegisteredInToolEvents(toolEvents);

          if (registered && slug) {
            const app = getUserAppBySlug(slug);
            if (app?.status === "published") {
              yield {
                type: "user_app_published",
                slug,
                appId: app.id,
              };
              yield {
                type: "status",
                phase: "app-builder",
                message: `Registered in VisionOS: ${app.name}`,
              };
              if (!finalReply.includes("Start menu") && !finalReply.includes("My Apps")) {
                finalReply += `\n\n**Installed in VisionOS** — open **Start menu → My Apps → ${app.name}**.`;
              }
            }
          } else if (existingSlug) {
            yield {
              type: "status",
              phase: "app-builder",
              message: `App built at apps/${existingSlug}/ but not registered — run register_user_app or publish API`,
            };
            if (!finalReply.includes("register_user_app") && !finalReply.includes("/publish")) {
              finalReply +=
                `\n\n**Not registered yet** — run \`register_user_app\` (local agent) or ` +
                `\`curl -s -X POST "http://127.0.0.1:${config.port}/api/user-apps/${existingSlug}/publish"\` ` +
                `so the app appears in **My Apps**.`;
            }
          }
        }

        addUiMessage(conversation, {
          role: "assistant",
          content: finalReply,
          ...(askMode ? { ask: true } : {}),
          ...(appBuilderFlow ? { appBuilder: true } : {}),
        });
        conversation.cwd = getThreadCwd(threadId);
        await saveConversation(conversation);

        let context;
        try {
          context = await getConversationContext([]);
        } catch {
          context = {
            limit: config.llm.context,
            reserved: 0,
            used: 0,
            remaining: config.llm.context,
            percent: 0,
          };
        }

        yield { type: "context", ...context };
        yield {
          type: "message",
          node: "agent",
          content: finalReply,
          cwd: getThreadCwd(threadId),
          workspace: config.workspaceDir,
          conversationId: threadId,
        };
        return;
      } catch (error) {
        if (error instanceof CursorRunFailedError) {
          if (attempt < 2) {
            await invalidateCursorAgent(conversation.id);
            yield { type: "stream_end", retract: true };
            yield {
              type: "status",
              phase: "cursor",
              message: "Cursor run failed, retrying with a fresh agent…",
            };
            continue;
          }
          const { run, runResult, streamState: failedState } = error.payload;
          throw new Error(
            await formatCursorRunFailure(
              run,
              runResult,
              failedState,
              requestedModel,
            ),
          );
        }

        if (isAgentBusyError(error)) {
          await invalidateCursorAgent(conversation.id);
          throw new Error(
            "Cursor agent still has a run in progress from an interrupted turn. Wait a moment and try again, or start a new conversation.",
          );
        }
        if (error instanceof CursorAgentError) {
          throw new Error(
            `Cursor SDK error: ${error.message}${error.isRetryable ? " (retryable)" : ""}`,
          );
        }
        throw error;
      }
    }
  } finally {
    releaseLock();
  }
}
