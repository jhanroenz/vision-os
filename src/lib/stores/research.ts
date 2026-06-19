import { get, writable } from 'svelte/store';
import {
  deleteResearchSession,
  getResearchSession,
  listResearchSessions,
  streamResearch,
  updateResearchSessionTitle,
  type ResearchMediaAsset,
  type ResearchSessionDetail,
  type ResearchSessionSummary,
  type ResearchTier
} from '$lib/api/research';

export interface ResearchActivityItem {
  id: string;
  type: string;
  text: string;
  at: number;
}

interface ResearchState {
  loading: boolean;
  running: boolean;
  error: string | null;
  sessions: ResearchSessionSummary[];
  activeId: string;
  active: ResearchSessionDetail | null;
  pendingQuery: string;
  tier: ResearchTier;
  activity: ResearchActivityItem[];
  currentAction: string;
  media: ResearchMediaAsset[];
}

const defaultState: ResearchState = {
  loading: false,
  running: false,
  error: null,
  sessions: [],
  activeId: '',
  active: null,
  pendingQuery: '',
  tier: 'standard',
  activity: [],
  currentAction: '',
  media: []
};

const internal = writable<ResearchState>(defaultState);

function setState(updater: (state: ResearchState) => ResearchState) {
  internal.update((state) => updater(state));
}

function pushActivity(state: ResearchState, type: string, text: string): ResearchState {
  return {
    ...state,
    activity: [...state.activity, { id: crypto.randomUUID(), type, text, at: Date.now() }]
  };
}

function getReportMedia(session: ResearchSessionDetail | null): ResearchMediaAsset[] {
  const media = session?.reportJson && Array.isArray(session.reportJson.media) ? session.reportJson.media : [];
  return media.filter((item): item is ResearchMediaAsset => Boolean(item && item.type && item.url));
}

function mergeMedia(existing: ResearchMediaAsset[], incoming: ResearchMediaAsset[]): ResearchMediaAsset[] {
  const byKey = new Map<string, ResearchMediaAsset>();
  for (const item of [...existing, ...incoming]) {
    const key = item.id || item.embedUrl || item.url;
    if (!key) continue;
    byKey.set(key, item);
  }
  return [...byKey.values()];
}

export const research = {
  subscribe: internal.subscribe,

  async loadSessions() {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const sessions = await listResearchSessions();
      setState((s) => ({ ...s, sessions, loading: false }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  },

  async open(id: string) {
    if (!id) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const session = await getResearchSession(id);
      setState((s) => ({
        ...s,
        loading: false,
        activeId: id,
        active: session,
        pendingQuery: '',
        tier: session.tier ?? s.tier,
        media: getReportMedia(session)
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  },

  setTier(tier: ResearchTier) {
    setState((s) => ({ ...s, tier }));
  },

  async rename(id: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    await updateResearchSessionTitle(id, trimmed);
    setState((s) => ({
      ...s,
      sessions: s.sessions.map((item) => (item.id === id ? { ...item, title: trimmed } : item)),
      active: s.active && s.active.id === id ? { ...s.active, title: trimmed } : s.active
    }));
  },

  async remove(id: string) {
    await deleteResearchSession(id);
    setState((s) => ({
      ...s,
      sessions: s.sessions.filter((item) => item.id !== id),
      activeId: s.activeId === id ? '' : s.activeId,
      active: s.activeId === id ? null : s.active
    }));
  },

  clearActive() {
    setState((s) => ({
      ...s,
      activeId: '',
      active: null,
      pendingQuery: '',
      error: null,
      activity: [],
      media: []
    }));
  },

  async run(message: string) {
    const text = message.trim();
    if (!text) return;
    const state = get(internal);
    if (state.running) return;

    setState((s) => ({
      ...s,
      running: true,
      error: null,
      pendingQuery: text,
      currentAction: 'Starting research...',
      activity: [],
      media: []
    }));

    let streamSessionId = '';
    let reportMarkdown = '';
    let sawSearchError = false;
    let searchErrorMessage = '';
    let sawAnySource = false;

    try {
      await streamResearch(
        { message: text, tier: state.tier },
        {
          onEvent(event) {
            setState((s) => {
              let next = { ...s };
              if (event.type === 'research_session') {
                streamSessionId = String(event.sessionId ?? '');
                if (streamSessionId && !next.sessions.some((item) => item.id === streamSessionId)) {
                  next.sessions = [
                    {
                      id: streamSessionId,
                      title: String(event.query ?? text).slice(0, 60),
                      userQuery: String(event.query ?? text),
                      tier: (event.tier as ResearchTier) ?? next.tier,
                      status: 'collecting',
                      preview: String(event.query ?? text),
                      createdAt: Date.now()
                    },
                    ...next.sessions
                  ];
                }
                next.activeId = streamSessionId || next.activeId;
              }
              if (event.type === 'document_type') {
                next.currentAction = `Formatting as ${String(event.templateLabel ?? 'report')}…`;
                next = pushActivity(next, 'document_type', next.currentAction);
              }
              if (event.type === 'status') {
                next.currentAction = String(event.message ?? '');
                next = pushActivity(next, 'status', next.currentAction || 'Working...');
              }
              if (event.type === 'research_search') {
                next.currentAction = `Searching: ${String(event.query ?? '')}`;
                next = pushActivity(next, 'search', next.currentAction);
              }
              if (event.type === 'research_source') {
                const source = (event.source ?? {}) as { title?: string; url?: string };
                sawAnySource = true;
                next = pushActivity(next, 'source', source.title || source.url || 'Source collected');
              }
              if (event.type === 'research_media') {
                const media = event.media as ResearchMediaAsset | undefined;
                if (media?.url && media?.type) {
                  next.media = mergeMedia(next.media, [media]);
                  next = pushActivity(next, 'media', `Media found: ${media.title || media.url}`);
                }
              }
              if (event.type === 'research_search_error') {
                sawSearchError = true;
                const query = String(event.query ?? '').trim();
                const reason = String(event.error ?? 'Search failed').trim();
                searchErrorMessage = reason || searchErrorMessage;
                next = pushActivity(
                  next,
                  'search_error',
                  query ? `Search failed (${query}): ${reason}` : `Search failed: ${reason}`
                );
              }
              if (event.type === 'research_progress') {
                next.currentAction = `Collected ${String(event.sources ?? 0)} sources`;
              }
              if (event.type === 'research_report' || event.type === 'message') {
                reportMarkdown = String(event.markdown ?? event.content ?? reportMarkdown);
                const report = (event.report ?? null) as { media?: ResearchMediaAsset[] } | null;
                if (Array.isArray(report?.media)) {
                  next.media = mergeMedia(next.media, report.media);
                }
              }
              return next;
            });
          },
          onError(messageError) {
            setState((s) => ({ ...s, error: messageError }));
          }
        }
      );

      await research.loadSessions();
      if (streamSessionId) {
        await research.open(streamSessionId);
      }
      if (!streamSessionId && reportMarkdown) {
        setState((s) => ({
          ...s,
          active: {
            id: '',
            title: 'Research',
            userQuery: text,
            tier: s.tier,
            status: 'completed',
            plan: null,
            reportMarkdown,
            reportJson: { media: s.media },
            createdAt: Date.now()
          },
          media: s.media
        }));
      }

      if (sawSearchError && !sawAnySource) {
        const hint =
          'Web search failed. Check that SearXNG is running (packaged builds use http://127.0.0.1:37583).';
        setState((s) => ({
          ...s,
          error: searchErrorMessage ? `${hint} Last error: ${searchErrorMessage}` : hint
        }));
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err)
      }));
    } finally {
      setState((s) => ({ ...s, running: false, currentAction: '' }));
    }
  }
};
