import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { getDb } from "./db.js";
import {
  setThreadCwdInMemory,
  getThreadCwdFromMemory,
  sanitizeWorkspaceRelativePath,
  ensureThreadWorkspace,
} from "./workspace.js";
import { getConversationContext, compactMessages } from "./context.js";
import { createTools } from "./tools/index.js";
import {
  activateConversation,
  clearActiveConversation,
  getActiveConversationId,
} from "./slots.js";

const cache = new Map();

function buildSystemPlaceholder(cwd = ".") {
  return { role: "system", content: "__SYSTEM__", _cwd: cwd };
}

function rowToConversation(row, uiMessages, llmMessages) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cwd: row.cwd,
    projectRoot: row.project_root ?? ".",
    workspaceRootSource: row.workspace_root_source ?? "default",
    cursorAgentId: row.cursor_agent_id ?? null,
    compactSummary: row.compact_summary,
    uiMessages,
    llmMessages,
  };
}

function loadUiMessages(conversationId) {
  const rows = getDb()
    .prepare(
      `SELECT id, role, content, tools, compact, created_at
       FROM ui_messages WHERE conversation_id = ?
       ORDER BY created_at ASC`,
    )
    .all(conversationId);

  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    ...(row.tools ? { tools: JSON.parse(row.tools) } : {}),
    ...(row.compact ? { compact: true } : {}),
  }));
}

function loadLlmMessages(conversationId) {
  const rows = getDb()
    .prepare(
      `SELECT role, content, tool_calls, tool_call_id
       FROM llm_messages WHERE conversation_id = ?
       ORDER BY position ASC`,
    )
    .all(conversationId);

  return rows.map((row) => ({
    role: row.role,
    content: row.content ?? "",
    ...(row.tool_calls ? { tool_calls: JSON.parse(row.tool_calls) } : {}),
    ...(row.tool_call_id ? { tool_call_id: row.tool_call_id } : {}),
  }));
}

function loadConversationFromDb(id) {
  const row = getDb()
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(id);

  if (!row) return null;

  const uiMessages = loadUiMessages(id);
  let llmMessages = loadLlmMessages(id);

  if (llmMessages.length === 0) {
    llmMessages = [buildSystemPlaceholder(row.cwd)];
  }

  return rowToConversation(row, uiMessages, llmMessages);
}

function persistConversation(conversation) {
  const now = new Date().toISOString();
  conversation.updatedAt = now;

  const save = getDb().transaction(() => {
    getDb()
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at, cwd, project_root, workspace_root_source, compact_summary, cursor_agent_id)
         VALUES (@id, @title, @created_at, @updated_at, @cwd, @project_root, @workspace_root_source, @compact_summary, @cursor_agent_id)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           updated_at = excluded.updated_at,
           cwd = excluded.cwd,
           project_root = excluded.project_root,
           workspace_root_source = excluded.workspace_root_source,
           compact_summary = excluded.compact_summary,
           cursor_agent_id = excluded.cursor_agent_id`,
      )
      .run({
        id: conversation.id,
        title: conversation.title,
        created_at: conversation.createdAt,
        updated_at: conversation.updatedAt,
        cwd: conversation.cwd ?? ".",
        project_root: conversation.projectRoot ?? ".",
        workspace_root_source: conversation.workspaceRootSource ?? "default",
        compact_summary: conversation.compactSummary ?? null,
        cursor_agent_id: conversation.cursorAgentId ?? null,
      });

    getDb()
      .prepare("DELETE FROM ui_messages WHERE conversation_id = ?")
      .run(conversation.id);

    const insertUi = getDb().prepare(
      `INSERT INTO ui_messages (id, conversation_id, role, content, tools, compact, created_at)
       VALUES (@id, @conversation_id, @role, @content, @tools, @compact, @created_at)`,
    );

    for (const msg of conversation.uiMessages) {
      insertUi.run({
        id: msg.id,
        conversation_id: conversation.id,
        role: msg.role,
        content: msg.content,
        tools: msg.tools ? JSON.stringify(msg.tools) : null,
        compact: msg.compact ? 1 : 0,
        created_at: msg.createdAt ?? now,
      });
    }

    getDb()
      .prepare("DELETE FROM llm_messages WHERE conversation_id = ?")
      .run(conversation.id);

    const insertLlm = getDb().prepare(
      `INSERT INTO llm_messages (conversation_id, position, role, content, tool_calls, tool_call_id)
       VALUES (@conversation_id, @position, @role, @content, @tool_calls, @tool_call_id)`,
    );

    conversation.llmMessages.forEach((msg, index) => {
      insertLlm.run({
        conversation_id: conversation.id,
        position: index,
        role: msg.role,
        content: msg.content ?? null,
        tool_calls: msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
        tool_call_id: msg.tool_call_id ?? null,
      });
    });
  });

  save();
  cache.set(conversation.id, conversation);
}

export function createEmptyConversation(id = randomUUID()) {
  const now = new Date().toISOString();
  return {
    id,
    title: "New conversation",
    createdAt: now,
    updatedAt: now,
    cwd: ".",
    projectRoot: ".",
    workspaceRootSource: "default",
    compactSummary: null,
    uiMessages: [],
    llmMessages: [buildSystemPlaceholder(".")],
  };
}

export async function listConversations() {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              (SELECT content FROM ui_messages
               WHERE conversation_id = c.id AND role = 'user'
               ORDER BY created_at ASC LIMIT 1) AS preview
       FROM conversations c
       ORDER BY c.updated_at DESC`,
    )
    .all();

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preview: row.preview?.slice(0, 80) ?? "",
  }));
}

export async function getConversation(id, { createIfMissing = false } = {}) {
  if (cache.has(id)) {
    const cached = cache.get(id);
    const safeCwd = sanitizeWorkspaceRelativePath(cached.cwd ?? ".");
    if (safeCwd !== cached.cwd) {
      cached.cwd = safeCwd;
      persistConversation(cached);
    }
    setThreadCwdInMemory(id, safeCwd);
    return cached;
  }

  const conversation = loadConversationFromDb(id);

  if (conversation) {
    const safeCwd = sanitizeWorkspaceRelativePath(conversation.cwd ?? ".");
    if (safeCwd !== conversation.cwd) {
      conversation.cwd = safeCwd;
      persistConversation(conversation);
    }
    cache.set(id, conversation);
    setThreadCwdInMemory(id, safeCwd);
    return conversation;
  }

  if (!createIfMissing) return null;

  const created = createEmptyConversation(id);
  persistConversation(created);
  setThreadCwdInMemory(id, ".");
  return created;
}

export async function createConversation() {
  const conversation = createEmptyConversation();
  persistConversation(conversation);
  setThreadCwdInMemory(conversation.id, ".");
  return conversation;
}

export async function updateConversation(id, { title, workspaceRoot } = {}) {
  const conversation = await getConversation(id);
  if (!conversation) throw new Error("Conversation not found");

  if (title !== undefined) {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Title cannot be empty");
    conversation.title = trimmed;
  }

  if (workspaceRoot !== undefined) {
    const { setConversationWorkspaceRoot } = await import("./conversationWorkspace.js");
    await setConversationWorkspaceRoot(conversation, workspaceRoot, {
      source: "user",
      persist: false,
    });
  }

  await saveConversation(conversation);
  return conversation;
}

export async function deleteConversation(id) {
  cache.delete(id);
  getDb().prepare("DELETE FROM conversations WHERE id = ?").run(id);
  if (getActiveConversationId() === id) {
    clearActiveConversation();
  }
}

export async function activateConversationContext(id) {
  const conversation = await getConversation(id);
  if (!conversation) throw new Error("Conversation not found");

  const { applyConversationWorkspaceToThread, serializeConversationWorkspace } =
    await import("./conversationWorkspace.js");
  await applyConversationWorkspaceToThread(id, conversation);
  await ensureThreadWorkspace(id);

  const messages = await resolveLlmMessages(conversation);
  const slot = await activateConversation(id);

  return {
    conversationId: id,
    context: await getConversationContext(messages),
    slot,
    ...serializeConversationWorkspace(conversation),
  };
}

export function getConversationCwd(id) {
  const cached = cache.get(id);
  if (cached?.cwd) return sanitizeWorkspaceRelativePath(cached.cwd);
  return sanitizeWorkspaceRelativePath(getThreadCwdFromMemory(id));
}

export async function setConversationCwd(id, cwd) {
  const conversation = await getConversation(id, { createIfMissing: true });
  conversation.cwd = sanitizeWorkspaceRelativePath(cwd ?? ".");
  setThreadCwdInMemory(id, conversation.cwd);
  await saveConversation(conversation);
}

export function addUiMessage(conversation, message) {
  conversation.uiMessages.push({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...message,
  });
}

export async function saveConversation(conversation) {
  persistConversation(conversation);
}

export async function setConversationCursorAgentId(conversationId, agentId) {
  const conversation = await getConversation(conversationId);
  if (!conversation) return;
  conversation.cursorAgentId = agentId ? String(agentId) : null;
  getDb()
    .prepare("UPDATE conversations SET cursor_agent_id = ? WHERE id = ?")
    .run(conversation.cursorAgentId, conversationId);
  cache.set(conversationId, conversation);
}

export async function getConversationWithContext(id) {
  const conversation = await getConversation(id, { createIfMissing: true });
  const { applyConversationWorkspaceToThread, serializeConversationWorkspace } =
    await import("./conversationWorkspace.js");
  await applyConversationWorkspaceToThread(id, conversation);
  const context = await getConversationContext(
    await resolveLlmMessages(conversation),
  );

  return {
    ...conversation,
    context,
    ...serializeConversationWorkspace(conversation),
  };
}

export async function compactConversation(id, { auto = false, percent } = {}) {
  const conversation = await getConversation(id);
  if (!conversation) throw new Error("Conversation not found");

  const llmMessages = await resolveLlmMessages(conversation);
  const { messages, summary, compacted } = await compactMessages(llmMessages, {
    keepRecent: config.llm.compactKeepRecent,
  });

  if (!compacted) {
    const context = await getConversationContext(llmMessages);
    return { conversation, context, compacted: false };
  }

  conversation.compactSummary = summary;
  conversation.llmMessages = messages.map((m) =>
    m.role === "system" ? buildSystemPlaceholder(conversation.cwd) : m,
  );

  const label = auto
    ? `[Auto-compacted at ${Math.round(percent ?? 0)}% context]`
    : "[Context compacted]";

  addUiMessage(conversation, {
    role: "assistant",
    content: `${label}\n\n${summary}`,
    compact: true,
  });

  await saveConversation(conversation);

  const resolved = await resolveLlmMessages(conversation);
  const context = await getConversationContext(resolved);

  return { conversation, context, compacted: true, summary };
}

export async function resolveLlmMessages(conversation, { promptProfile } = {}) {
  const {
    buildSystemPrompt,
    buildSystemPromptLite,
    buildSystemPromptAsk,
    buildSystemPromptResearch,
    buildSystemPromptExplore,
  } = await import("./prompt.js");
  const { listMemoriesForPrompt } = await import("./coreMemory.js");
  const { listSkillsForPrompt } = await import("./skills.js");
  const { listFailuresForPrompt } = await import("./failureMemory.js");
  const { getTurnIntent } = await import("./turnIntent.js");
  const {
    getThreadCwd,
    setThreadCwdInMemory,
    restoreLockedProjectRoot,
    getActiveProjectRoot,
    getLockedProjectRoot,
  } = await import("./workspace.js");

  setThreadCwdInMemory(conversation.id, conversation.cwd ?? ".");
  const { applyConversationWorkspaceToThread, conversationWorkspacePromptBlock } =
    await import("./conversationWorkspace.js");
  await applyConversationWorkspaceToThread(conversation.id, conversation);

  const turnIntent = getTurnIntent(conversation.id);
  const profile =
    promptProfile ?? turnIntent?.profile ?? (turnIntent?.casualChat ? "chat" : "code");
  const tools = createTools({
    threadId: conversation.id,
    turnIntent,
    askMode: turnIntent?.askMode === true,
  });
  const cwd = getThreadCwd(conversation.id) ?? conversation.cwd ?? ".";
  conversation.cwd = cwd;
  const activeProject = getActiveProjectRoot(conversation.id);
  const lockedProjectRoot = getLockedProjectRoot(conversation.id);
  const memories = listMemoriesForPrompt(activeProject);
  const skills = listSkillsForPrompt(activeProject);
  const lastUserMessage = [...(conversation.llmMessages ?? [])]
    .reverse()
    .find((m) => m.role === "user" && typeof m.content === "string")?.content ?? "";
  const failures = listFailuresForPrompt(activeProject, lastUserMessage);

  const promptCtx = {
    memories,
    skills,
    failures,
    activeProject,
    cwd,
    lockedProjectRoot,
    conversationWorkspaceBlock: conversationWorkspacePromptBlock(conversation),
  };

  const { buildCoreSystemPrompt, isPromptCompactMode, needsGemmaToolAnchor } =
    await import("./promptCore.js");

  if (isPromptCompactMode()) {
    const gemmaAnchor = needsGemmaToolAnchor({ profile, step: 0 });
    const core = buildCoreSystemPrompt(tools, {
      profile,
      ...promptCtx,
      gemmaAnchor,
    });
    return conversation.llmMessages.map((m) =>
      m.role === "system" || m.content === "__SYSTEM__"
        ? { role: "system", content: core }
        : m,
    );
  }

  if (turnIntent?.askMode) {
    const ask = buildSystemPromptAsk(tools, promptCtx);
    return conversation.llmMessages.map((m) =>
      m.role === "system" || m.content === "__SYSTEM__"
        ? { role: "system", content: ask }
        : m,
    );
  }

  if (profile === "chat" || turnIntent?.casualChat) {
    const lite = buildSystemPromptLite(tools, promptCtx);
    return conversation.llmMessages.map((m) =>
      m.role === "system" || m.content === "__SYSTEM__"
        ? { role: "system", content: lite }
        : m,
    );
  }

  if (profile === "research") {
    const research = buildSystemPromptResearch(tools, promptCtx);
    return conversation.llmMessages.map((m) =>
      m.role === "system" || m.content === "__SYSTEM__"
        ? { role: "system", content: research }
        : m,
    );
  }

  const { buildCodebaseSnapshot } = await import("./codebase/context.js");
  const { planStatusBlock } = await import("./taskPlan.js");
  const { buildFileContextBlock } = await import("./fileContext.js");

  const codebaseSnapshot = await buildCodebaseSnapshot(
    conversation.id,
    getThreadCwd,
    getActiveProjectRoot,
  );

  if (profile === "explore") {
    const fileBlock = buildFileContextBlock(conversation.id, {
      activeProject,
      lockedProjectRoot: getLockedProjectRoot(conversation.id),
      cwd,
    });
    const snapshot = [codebaseSnapshot, fileBlock].filter(Boolean).join("\n\n");
    const explore = buildSystemPromptExplore(tools, {
      ...promptCtx,
      codebaseSnapshot: snapshot,
    });
    return conversation.llmMessages.map((m) =>
      m.role === "system" || m.content === "__SYSTEM__"
        ? { role: "system", content: explore }
        : m,
    );
  }

  const planBlock = planStatusBlock(conversation.id);
  const fileBlock = buildFileContextBlock(conversation.id, {
    activeProject: getActiveProjectRoot(conversation.id),
    lockedProjectRoot: getLockedProjectRoot(conversation.id),
    cwd,
  });
  const { planFileBlock } = await import("./executionPlan.js");
  const { getTaskPlan } = await import("./taskPlan.js");
  const activePlan = getTaskPlan(conversation.id);
  const planFileHint = planFileBlock(
    conversation.id,
    activePlan?.planFile ?? null,
  );
  const snapshotWithPlan = [codebaseSnapshot, fileBlock, planFileHint, planBlock]
    .filter(Boolean)
    .join("\n\n");

  const full = buildSystemPrompt(tools, cwd, {
    ...promptCtx,
    codebaseSnapshot: snapshotWithPlan,
  });

  return conversation.llmMessages.map((m) =>
    m.role === "system" || m.content === "__SYSTEM__"
      ? { role: "system", content: full }
      : m,
  );
}
