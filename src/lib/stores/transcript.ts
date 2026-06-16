import { get, writable } from 'svelte/store';
import {
  getTranscriptEntries,
  getTranscriptMeta,
  type TranscriptEntriesResponse,
  type TranscriptMeta
} from '$lib/api/transcript';

const LIVE_POLL_MS = 5000;
const DEFAULT_TAIL = 800;

interface TranscriptState {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  meta: TranscriptMeta | null;
  entries: TranscriptEntriesResponse['entries'];
  tail: number;
  turnFile: string;
}

const defaultState = (): TranscriptState => ({
  loading: false,
  refreshing: false,
  error: null,
  meta: null,
  entries: [],
  tail: DEFAULT_TAIL,
  turnFile: ''
});

const internal = writable<Record<string, TranscriptState>>({});
const liveTimers = new Map<string, ReturnType<typeof setInterval>>();
const liveRefs = new Map<string, number>();
const livePaused = new Map<string, boolean>();

function transcriptFingerprint(
  meta: TranscriptMeta | null,
  entries: TranscriptEntriesResponse['entries']
): string {
  const last = entries.at(-1);
  const lastKey =
    last && typeof last === 'object'
      ? `${String((last as { seq?: unknown }).seq ?? '')}:${String((last as { ts?: unknown }).ts ?? '')}`
      : '';
  return [
    meta?.totalLines ?? 0,
    meta?.activeTurn ?? '',
    entries.length,
    lastKey
  ].join('|');
}

function isLivePollAllowed(conversationId: string): boolean {
  if (livePaused.get(conversationId)) return false;
  if (typeof document !== 'undefined' && document.hidden) return false;
  return true;
}

function updateTranscriptState(
  conversationId: string,
  updater: (state: TranscriptState) => TranscriptState
) {
  internal.update((map) => {
    const current = map[conversationId] ?? defaultState();
    return { ...map, [conversationId]: updater(current) };
  });
}

function getState(conversationId: string): TranscriptState {
  return get(internal)[conversationId] ?? defaultState();
}

export const transcriptStore = {
  subscribe: internal.subscribe,

  async load(
    conversationId: string,
    options?: { tail?: number; turnFile?: string; silent?: boolean }
  ) {
    const current = getState(conversationId);
    const tail = options?.tail ?? current.tail;
    const turnFile = options?.turnFile ?? current.turnFile;
    const silent = options?.silent ?? false;

    updateTranscriptState(conversationId, (s) => ({
      ...s,
      tail,
      turnFile,
      loading: silent ? s.loading : true,
      refreshing: silent,
      error: silent ? s.error : null
    }));

    try {
      const [meta, entries] = await Promise.all([
        getTranscriptMeta(conversationId),
        getTranscriptEntries(conversationId, {
          tail,
          turnFile: turnFile || undefined
        })
      ]);
      const nextFingerprint = transcriptFingerprint(meta, entries.entries);
      const prevFingerprint = transcriptFingerprint(current.meta, current.entries);
      if (silent && nextFingerprint === prevFingerprint) {
        updateTranscriptState(conversationId, (s) => ({
          ...s,
          loading: false,
          refreshing: false
        }));
        return;
      }
      updateTranscriptState(conversationId, (s) => ({
        ...s,
        loading: false,
        refreshing: false,
        meta,
        entries: entries.entries
      }));
    } catch (err) {
      updateTranscriptState(conversationId, (s) => ({
        ...s,
        loading: false,
        refreshing: false,
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  },

  async setTail(conversationId: string, tail: number) {
    const nextTail = Math.min(Math.max(Number(tail) || DEFAULT_TAIL, 50), 5000);
    await transcriptStore.load(conversationId, { tail: nextTail });
  },

  async setTurnFile(conversationId: string, turnFile: string) {
    await transcriptStore.load(conversationId, { turnFile });
  },

  startLive(conversationId: string) {
    const id = String(conversationId ?? '').trim();
    if (!id) return;
    const refs = (liveRefs.get(id) ?? 0) + 1;
    liveRefs.set(id, refs);
    if (refs > 1) return;

    livePaused.delete(id);
    void transcriptStore.load(id);
    const timer = setInterval(() => {
      if (!isLivePollAllowed(id)) return;
      void transcriptStore.load(id, { silent: true });
    }, LIVE_POLL_MS);
    liveTimers.set(id, timer);
  },

  pauseLive(conversationId: string) {
    const id = String(conversationId ?? '').trim();
    if (!id) return;
    livePaused.set(id, true);
  },

  resumeLive(conversationId: string) {
    const id = String(conversationId ?? '').trim();
    if (!id) return;
    const wasPaused = livePaused.get(id) === true;
    livePaused.delete(id);
    if (wasPaused && liveTimers.has(id) && isLivePollAllowed(id)) {
      void transcriptStore.load(id, { silent: true });
    }
  },

  stopLive(conversationId: string) {
    const id = String(conversationId ?? '').trim();
    if (!id) return;
    const refs = (liveRefs.get(id) ?? 1) - 1;
    if (refs > 0) {
      liveRefs.set(id, refs);
      return;
    }
    liveRefs.delete(id);
    livePaused.delete(id);
    const timer = liveTimers.get(id);
    if (timer) clearInterval(timer);
    liveTimers.delete(id);
  }
};
