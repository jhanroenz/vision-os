import {
  sanitizeWorkspaceRelativePath,
  lockProjectRoot,
  setThreadCwdInMemory,
  setActiveProjectRootInMemory,
  getThreadState,
} from "./workspace.js";

export const DEFAULT_CONVERSATION_WORKSPACE_ROOT = ".";

/** @typedef {'default' | 'user' | 'agent'} WorkspaceRootSource */

export function normalizeConversationWorkspaceRoot(input) {
  const safe = sanitizeWorkspaceRelativePath(input ?? DEFAULT_CONVERSATION_WORKSPACE_ROOT);
  return safe || DEFAULT_CONVERSATION_WORKSPACE_ROOT;
}

export function getConversationWorkspaceRoot(conversation) {
  return normalizeConversationWorkspaceRoot(
    conversation?.projectRoot ?? conversation?.workspaceRoot ?? DEFAULT_CONVERSATION_WORKSPACE_ROOT,
  );
}

export function isUserDefinedConversationRoot(conversation) {
  return conversation?.workspaceRootSource === "user";
}

export function isUserDefinedConversationRootForThread(threadId) {
  const source = getThreadState(threadId).conversationRootSource;
  return source === "user" || source === "conversation_user";
}

/**
 * Apply persisted conversation workspace root to in-memory thread state + lock.
 */
export async function applyConversationWorkspaceToThread(threadId, conversation) {
  const root = getConversationWorkspaceRoot(conversation);
  const userDefined = isUserDefinedConversationRoot(conversation);

  await lockProjectRoot(threadId, root, {
    source: userDefined ? "conversation_user" : "conversation_restore",
    conversation,
  });

  const state = getThreadState(threadId);
  state.conversationRootSource = userDefined ? "user" : (conversation?.workspaceRootSource ?? "default");

  setThreadCwdInMemory(threadId, root);
  if (root !== DEFAULT_CONVERSATION_WORKSPACE_ROOT) {
    setActiveProjectRootInMemory(threadId, root);
  }

  if (conversation) {
    conversation.projectRoot = root;
    conversation.cwd = root;
  }

  return root;
}

/**
 * Update conversation record + thread lock (UI or API).
 */
export async function setConversationWorkspaceRoot(
  conversation,
  relativePath,
  { source = "user", persist = true } = {},
) {
  const root = normalizeConversationWorkspaceRoot(relativePath);
  conversation.projectRoot = root;
  conversation.workspaceRootSource = source;
  conversation.cwd = root;

  await applyConversationWorkspaceToThread(conversation.id, conversation);

  if (persist) {
    const { saveConversation } = await import("./conversations.js");
    await saveConversation(conversation);
  }

  return {
    workspaceRoot: root,
    workspaceRootSource: source,
    cwd: root,
  };
}

export function conversationWorkspacePromptBlock(conversation) {
  const root = getConversationWorkspaceRoot(conversation);
  const userDefined = isUserDefinedConversationRoot(conversation);
  const lines = [
    "CONVERSATION PROJECT ROOT (mandatory — server-enforced for all tools):",
    `- Root: ${root === DEFAULT_CONVERSATION_WORKSPACE_ROOT ? "workspace top (.)" : root}`,
  ];
  if (userDefined) {
    lines.push("- Set by you in the UI — the agent must NOT switch to a different project folder.");
  }
  if (root === DEFAULT_CONVERSATION_WORKSPACE_ROOT) {
    lines.push(
      "- Use full paths from workspace top (e.g. failure-test/package.json, failure-test/src/index.js).",
    );
  } else {
    lines.push(
      `- Project-relative paths only: package.json, src/main.js (NOT ${root}/package.json — server adds the prefix).`,
      `- run_bash cwd is ${root}/ — use mkdir -p src, npm init -y (never mkdir ${root} or ${root}/src).`,
    );
  }
  return lines.join("\n");
}

export function serializeConversationWorkspace(conversation) {
  return {
    workspaceRoot: getConversationWorkspaceRoot(conversation),
    workspaceRootSource: conversation?.workspaceRootSource ?? "default",
    projectRoot: getConversationWorkspaceRoot(conversation),
  };
}
