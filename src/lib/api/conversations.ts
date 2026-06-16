export interface ConversationListItem {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  preview: string;
}

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt?: string;
  tools?: unknown;
  compact?: boolean;
}

export interface ConversationDetail {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  projectRoot?: string;
  workspaceRoot?: string;
  workspaceRootSource?: string;
  context?: unknown;
  uiMessages: UiMessage[];
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: string }).error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

export async function listConversations(): Promise<ConversationListItem[]> {
  const data = await api<{ conversations: ConversationListItem[] }>('/api/conversations');
  return data.conversations ?? [];
}

export async function createConversation(): Promise<ConversationDetail> {
  return api('/api/conversations', { method: 'POST' });
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  return api(`/api/conversations/${encodeURIComponent(id)}`);
}

export async function activateConversation(id: string): Promise<{
  conversationId: string;
  context?: unknown;
  workspaceRoot?: string;
  workspaceRootSource?: string;
}> {
  return api(`/api/conversations/${encodeURIComponent(id)}/activate`, { method: 'POST' });
}

export async function compactConversation(id: string): Promise<{
  compacted: boolean;
  summary?: string;
  context?: unknown;
}> {
  return api(`/api/conversations/${encodeURIComponent(id)}/compact`, { method: 'POST' });
}

export async function updateConversation(
  id: string,
  patch: { title?: string; workspaceRoot?: string }
): Promise<ConversationDetail> {
  return api(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
}

export async function deleteConversation(id: string): Promise<{ ok: true }> {
  return api(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
