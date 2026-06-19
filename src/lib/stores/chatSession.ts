import { get, writable } from 'svelte/store';
import { streamChat, type ChatEvent } from '$lib/api/chat';
import { activateConversation, getConversation, type UiMessage } from '$lib/api/conversations';
import { cancelShell } from '$lib/api/shell';
import {
  formatReasoningActivity,
  formatToolCallActivity,
  formatToolResultActivity,
  truncateActivity,
} from '$lib/utils/activityFormat';

export type ComposerMode = 'chat' | 'ask' | 'command' | 'appBuilder';

export interface ActivityItem {
  id: string;
  type: string;
  text: string;
  status?: 'active' | 'done' | 'fail';
  at: number;
  detail?: string;
}

export interface ExecutionPhase {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done';
}

export interface TaskPlanStep {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'skipped';
}

export interface TaskPlanSnapshot {
  title?: string;
  steps: TaskPlanStep[];
}

export interface QueuedMessage {
  id: string;
  text: string;
  mode: ComposerMode;
}

interface SessionState {
  loading: boolean;
  streaming: boolean;
  error: string | null;
  composerMode: ComposerMode;
  activityPhase: string;
  shellWaiting: boolean;
  currentAction: string;
  executionStackProfile: string;
  executionStack: ExecutionPhase[];
  taskPlan: TaskPlanSnapshot | null;
  messageQueue: QueuedMessage[];
  messages: UiMessage[];
  activityLog: ActivityItem[];
  eventLog: ChatEvent[];
  streamText: string;
}

type SessionsMap = Record<string, SessionState>;

const internal = writable<SessionsMap>({});

function ensureSession(map: SessionsMap, conversationId: string): SessionState {
  return (
    map[conversationId] ?? {
      loading: false,
      streaming: false,
      error: null,
      composerMode: 'chat',
      activityPhase: '',
      shellWaiting: false,
      currentAction: '',
      executionStackProfile: 'chat',
      executionStack: [],
      taskPlan: null,
      messageQueue: [],
      messages: [],
      activityLog: [],
      eventLog: [],
      streamText: ''
    }
  );
}

function updateSession(conversationId: string, updater: (session: SessionState) => SessionState) {
  internal.update((map) => {
    const session = ensureSession(map, conversationId);
    return { ...map, [conversationId]: updater(session) };
  });
}

function pushActivity(session: SessionState, type: string, text: string, detail?: string): SessionState {
  return {
    ...session,
    activityLog: [
      ...session.activityLog,
      {
        id: crypto.randomUUID(),
        type,
        text,
        at: Date.now(),
        status: 'done',
        detail
      }
    ]
  };
}

function appendReasoningActivity(session: SessionState, chunk: string): SessionState {
  if (!chunk) return session;
  const log = [...session.activityLog];
  const idx = log.findLastIndex((item) => item.type === 'reasoning');
  const prevDetail = idx >= 0 ? (log[idx].detail ?? '') : '';
  const full = `${prevDetail}${chunk}`;
  const entry: ActivityItem = {
    id: idx >= 0 ? log[idx].id : crypto.randomUUID(),
    type: 'reasoning',
    text: formatReasoningActivity(full),
    detail: full,
    at: idx >= 0 ? log[idx].at : Date.now(),
    status: 'active'
  };
  if (idx >= 0) log[idx] = entry;
  else log.push(entry);
  return {
    ...session,
    activityLog: log,
    activityPhase: truncateActivity(full, 80) || 'Thinking…',
    currentAction: 'Thinking…'
  };
}

function finalizeReasoningActivity(session: SessionState): SessionState {
  return {
    ...session,
    activityLog: session.activityLog.map((item) =>
      item.type === 'reasoning' && item.status === 'active' ? { ...item, status: 'done' } : item
    )
  };
}

function setPhase(session: SessionState, text: string): SessionState {
  return { ...session, activityPhase: text };
}

function setStack(session: SessionState, event: ChatEvent): SessionState {
  const phases = Array.isArray((event as { phases?: unknown[] }).phases)
    ? ((event as { phases?: unknown[] }).phases ?? [])
    : [];
  const mapped = phases.map((phase, index) => {
    const raw = (phase ?? {}) as Record<string, unknown>;
    return {
      id: String(raw.id ?? `phase-${index}`),
      label: String(raw.label ?? raw.name ?? `Phase ${index + 1}`),
      status:
        raw.status === 'done' || raw.status === 'active' || raw.status === 'pending'
          ? raw.status
          : 'pending'
    } as ExecutionPhase;
  });
  return {
    ...session,
    executionStack: mapped,
    executionStackProfile: String((event as { profile?: unknown }).profile ?? session.executionStackProfile)
  };
}

function setTaskPlan(session: SessionState, value: unknown): SessionState {
  if (!value || typeof value !== 'object') return { ...session, taskPlan: null };
  const src = value as { title?: unknown; steps?: unknown[] };
  const steps = Array.isArray(src.steps)
    ? src.steps.map((step, index) => {
        const raw = (step ?? {}) as Record<string, unknown>;
        const statusRaw = String(raw.status ?? 'pending');
        const status: TaskPlanStep['status'] =
          statusRaw === 'done' || statusRaw === 'skipped' || statusRaw === 'in_progress'
            ? statusRaw
            : 'pending';
        return {
          id: String(raw.id ?? `step-${index}`),
          label: String(raw.label ?? raw.title ?? `Step ${index + 1}`),
          status
        };
      })
    : [];
  return { ...session, taskPlan: { title: src.title ? String(src.title) : undefined, steps } };
}

export const chatSession = {
  subscribe: internal.subscribe,

  get(conversationId: string): SessionState {
    return ensureSession(get(internal), conversationId);
  },

  async load(conversationId: string) {
    updateSession(conversationId, (s) => ({ ...s, loading: true, error: null }));
    try {
      await activateConversation(conversationId);
      const detail = await getConversation(conversationId);
      updateSession(conversationId, (s) => ({
        ...s,
        loading: false,
        messages: detail.uiMessages ?? [],
        activityLog: [],
        activityPhase: '',
        shellWaiting: false,
        currentAction: '',
        executionStackProfile: 'chat',
        executionStack: [],
        taskPlan: null,
        eventLog: [],
        streamText: ''
      }));
    } catch (err) {
      updateSession(conversationId, (s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  },

  async send(conversationId: string, message: string, mode?: string) {
    const trimmed = message.trim();
    if (!trimmed) return;
    const composerMode = (mode ?? chatSession.get(conversationId).composerMode) as ComposerMode;
    const active = chatSession.get(conversationId);
    if (active.streaming) {
      updateSession(conversationId, (s) => ({
        ...s,
        messageQueue: [...s.messageQueue, { id: crypto.randomUUID(), text: trimmed, mode: composerMode }]
      }));
      return;
    }
    const userMessage: UiMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString()
    };
    updateSession(conversationId, (s) => ({
      ...s,
      streaming: true,
      error: null,
      composerMode,
      activityPhase: composerMode === 'chat' ? 'Thinking...' : `Mode: ${composerMode}`,
      currentAction: 'Preparing response',
      shellWaiting: false,
      activityLog: [],
      streamText: '',
      messages: [...s.messages, userMessage]
    }));

    try {
      await streamChat(
        { message: trimmed, threadId: conversationId, mode },
        {
          onEvent(event) {
            updateSession(conversationId, (s) => {
              let next: SessionState = { ...s, eventLog: [...s.eventLog, event] };
              if (event.type === 'message_delta' && typeof event.content === 'string') {
                next.streamText = `${next.streamText}${event.content}`;
              }
              if (event.type === 'status') {
                const phaseMessage = String(event.message ?? '').trim();
                if (phaseMessage) next = setPhase(next, phaseMessage);
                if (phaseMessage) next.currentAction = phaseMessage;
                if (String(event.phase ?? '') === 'thinking') {
                  next = pushActivity(next, 'status', 'Thinking…');
                } else if (phaseMessage) {
                  next = pushActivity(next, 'status', truncateActivity(phaseMessage, 140));
                }
              }
              if (event.type === 'turn_intent') {
                const profile = String(event.profile ?? 'chat');
                next = pushActivity(next, 'turn_intent', `Agent mode: ${profile}`);
                next.executionStackProfile = profile;
              }
              if (event.type === 'execution_stack') {
                next = setStack(next, event);
              }
              if (event.type === 'tool_call') {
                const name = String(event.name ?? 'tool');
                const args = (event.args ?? {}) as Record<string, unknown>;
                const summary = formatToolCallActivity(name, args);
                next = pushActivity(next, 'tool_call', summary, JSON.stringify(args));
                next.currentAction = summary;
              }
              if (event.type === 'tool_result') {
                const name = String(event.name ?? 'tool');
                const summary = formatToolResultActivity(
                  name,
                  event.content,
                  (event.resultSummary ?? {}) as Record<string, unknown>
                );
                next = pushActivity(next, 'tool_result', summary, String(event.content ?? ''));
                next.currentAction = summary;
                if (name === 'publish_user_app' || name === 'import_user_app' || name === 'register_user_app') {
                  void import('$lib/stores/userApps').then(({ loadUserApps }) => loadUserApps());
                }
              }
              if (event.type === 'user_app_published') {
                void import('$lib/stores/userApps').then(({ loadUserApps }) => loadUserApps());
              }
              if (event.type === 'reasoning' || event.type === 'reasoning_delta') {
                const chunk = String(event.content ?? event.text ?? '');
                if (chunk) next = appendReasoningActivity(next, chunk);
                else next = setPhase(next, 'Thinking…');
              }
              if (event.type === 'planning' || event.type === 'planning_delta') {
                const chunk = String(event.content ?? event.text ?? '');
                next = setPhase(next, 'Planning next steps…');
                next.currentAction = 'Planning';
                if (chunk) {
                  next = pushActivity(next, 'planning', truncateActivity(chunk, 140) || 'Planning…', chunk);
                }
              }
              if (event.type === 'task_plan') {
                next = setTaskPlan(next, (event as { plan?: unknown }).plan);
                next = pushActivity(next, 'task_plan', 'Updated task plan');
              }
              if (event.type === 'verification_plan') {
                next = pushActivity(next, 'verification_plan', 'Generated verification plan');
              }
              if (event.type === 'shell_input_required') {
                next.shellWaiting = true;
                next = setPhase(next, 'Command waiting for input...');
                next = pushActivity(next, 'shell_wait', 'Shell is waiting for input');
                next.currentAction = 'Shell waiting for input';
              }
              if (event.type === 'shell_start') {
                next = pushActivity(next, 'shell', `$ ${String(event.command ?? '')}`);
                next.currentAction = 'Running shell command';
              }
              if (event.type === 'shell_done') {
                next.shellWaiting = false;
                next = pushActivity(next, 'shell_done', 'Shell command finished');
                next.currentAction = 'Shell command finished';
              }
              if (event.type === 'workspace') {
                next = pushActivity(next, 'workspace', `Workspace: ${String(event.cwd ?? event.path ?? '.')}`);
              }
              if (event.type === 'message' && typeof event.content === 'string') {
                next = finalizeReasoningActivity(next);
                next.messages = [
                  ...next.messages,
                  {
                    id: `local-assistant-${Date.now()}`,
                    role: 'assistant',
                    content: event.content,
                    createdAt: new Date().toISOString()
                  }
                ];
                next.streamText = '';
                next.activityPhase = '';
                next.currentAction = '';
              }
              return next;
            });
          },
          onError(message) {
            updateSession(conversationId, (s) => ({ ...s, error: message }));
          }
        }
      );
      await chatSession.load(conversationId);
    } catch (err) {
      updateSession(conversationId, (s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      updateSession(conversationId, (s) => ({
        ...s,
        streaming: false,
        activityPhase: s.shellWaiting ? s.activityPhase : ''
      }));
      const queue = chatSession.get(conversationId).messageQueue;
      if (queue.length > 0) {
        const [next, ...rest] = queue;
        updateSession(conversationId, (s) => ({ ...s, messageQueue: rest }));
        void chatSession.send(conversationId, next.text, next.mode);
      }
    }
  },

  setComposerMode(conversationId: string, mode: ComposerMode) {
    updateSession(conversationId, (s) => ({ ...s, composerMode: mode }));
  },

  clearMessageQueue(conversationId: string) {
    updateSession(conversationId, (s) => ({ ...s, messageQueue: [] }));
  },

  async cancelShell(conversationId: string) {
    try {
      await cancelShell(conversationId);
      updateSession(conversationId, (s) => ({
        ...s,
        shellWaiting: false,
        activityPhase: '',
        currentAction: '',
        activityLog: [
          ...s.activityLog,
          {
            id: crypto.randomUUID(),
            type: 'shell',
            text: 'Shell command cancelled',
            at: Date.now(),
            status: 'done'
          }
        ]
      }));
    } catch (err) {
      updateSession(conversationId, (s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  }
};
