import { get, writable } from 'svelte/store';
import {
  createConversation as apiCreateConversation,
  deleteConversation as apiDeleteConversation,
  getConversation,
  listConversations,
  updateConversation,
  type ConversationDetail,
  type ConversationListItem
} from '$lib/api/conversations';

interface ConversationsState {
  loading: boolean;
  creating: boolean;
  error: string | null;
  items: ConversationListItem[];
  details: Record<string, ConversationDetail>;
}

function normalizeConversationListItem(raw: ConversationListItem | Record<string, unknown>): ConversationListItem {
  const id =
    typeof raw.id === 'string'
      ? raw.id
      : typeof raw.conversationId === 'string'
        ? raw.conversationId
        : typeof raw.threadId === 'string'
          ? raw.threadId
          : '';
  return {
    id,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : 'Untitled conversation',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
    preview: typeof raw.preview === 'string' ? raw.preview : ''
  };
}

const internal = writable<ConversationsState>({
  loading: false,
  creating: false,
  error: null,
  items: [],
  details: {}
});

function patch(partial: Partial<ConversationsState>) {
  internal.update((s) => ({ ...s, ...partial }));
}

export const conversations = {
  subscribe: internal.subscribe,

  async loadList() {
    patch({ loading: true, error: null });
    try {
      const items = (await listConversations())
        .map((item) => normalizeConversationListItem(item as ConversationListItem | Record<string, unknown>))
        .filter((item) => item.id.length > 0);
      patch({ items });
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      patch({ loading: false });
    }
  },

  async createConversation() {
    patch({ creating: true, error: null });
    try {
      const conversation = await apiCreateConversation();
      await conversations.loadList();
      internal.update((s) => ({
        ...s,
        details: { ...s.details, [conversation.id]: conversation }
      }));
      return conversation;
    } finally {
      patch({ creating: false });
    }
  },

  async loadConversation(id: string) {
    patch({ error: null });
    try {
      const detail = await getConversation(id);
      internal.update((s) => ({
        ...s,
        details: { ...s.details, [id]: detail }
      }));
      return detail;
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  getCachedConversation(id: string): ConversationDetail | null {
    return get(internal).details[id] ?? null;
  },

  async renameConversation(id: string, title: string) {
    patch({ error: null });
    const updated = await updateConversation(id, { title });
    internal.update((s) => ({
      ...s,
      details: { ...s.details, [id]: updated },
      items: s.items.map((item) => (item.id === id ? { ...item, title: updated.title } : item))
    }));
    return updated;
  },

  async deleteConversation(id: string) {
    patch({ error: null });
    await apiDeleteConversation(id);
    internal.update((s) => {
      const { [id]: _omit, ...details } = s.details;
      return {
        ...s,
        details,
        items: s.items.filter((item) => item.id !== id)
      };
    });
  }
};
