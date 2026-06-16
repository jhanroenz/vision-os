import type { TranscriptRecord } from '$lib/api/transcript';
import { transcriptTypeGroup } from '$lib/utils/transcriptFormat';

const DELTA_TYPES = new Set([
  'message_delta',
  'reasoning_delta',
  'planning_delta',
  'coding_executor_reasoning_delta',
  'coding_executor_delta'
]);

const SUPERSEDING_TYPES: Record<string, string> = {
  message_delta: 'message',
  reasoning_delta: 'reasoning',
  planning_delta: 'planning',
  coding_executor_reasoning_delta: 'coding_delegate_end',
  coding_executor_delta: 'coding_delegate_end'
};

export interface TranscriptViewSingle {
  kind: 'single';
  id: string;
  entry: TranscriptRecord;
}

export interface TranscriptViewStream {
  kind: 'stream';
  id: string;
  type: string;
  turnId: string | null;
  text: string;
  chunkCount: number;
  startTs: string;
  endTs: string;
  startSeq: number | null;
  endSeq: number | null;
  streaming: boolean;
  chunks: TranscriptRecord[];
}

export type TranscriptViewEntry = TranscriptViewSingle | TranscriptViewStream;

interface OpenStream {
  type: string;
  turnId: string | null;
  text: string;
  chunks: TranscriptRecord[];
  startTs: string;
  endTs: string;
  startSeq: number | null;
  endSeq: number | null;
}

function deltaText(entry: TranscriptRecord): string {
  const data = entry.data ?? {};
  return String(data.content ?? data.text ?? '');
}

function streamId(stream: OpenStream): string {
  return `stream:${stream.type}:${stream.turnId ?? 'none'}:${stream.startSeq ?? stream.startTs}`;
}

function flushStream(stream: OpenStream, streaming: boolean): TranscriptViewStream {
  return {
    kind: 'stream',
    id: streamId(stream),
    type: stream.type,
    turnId: stream.turnId,
    text: stream.text,
    chunkCount: stream.chunks.length,
    startTs: stream.startTs,
    endTs: stream.endTs,
    startSeq: stream.startSeq,
    endSeq: stream.endSeq,
    streaming,
    chunks: stream.chunks
  };
}

function sameStreamGroup(a: OpenStream, entry: TranscriptRecord): boolean {
  return a.type === entry.type && a.turnId === entry.turnId;
}

function resolveTurnId(entry: TranscriptRecord): string | null {
  if (entry.turnId) return entry.turnId;
  const data = entry.data ?? {};
  if (typeof data.turnId === 'string') return data.turnId;
  return null;
}

export function buildTranscriptViewEntries(
  entries: TranscriptRecord[],
  options?: { activeTurn?: string | null }
): TranscriptViewEntry[] {
  const activeTurn = options?.activeTurn ?? null;
  const result: TranscriptViewEntry[] = [];
  let open: OpenStream | null = null;
  let currentTurnId: string | null = null;

  const closeOpen = (streaming = false) => {
    if (!open) return;
    result.push(flushStream(open, streaming));
    open = null;
  };

  for (const entry of entries) {
    const turnId = resolveTurnId(entry);

    if (entry.type === 'turn_start') {
      currentTurnId = turnId ?? entry.turnId;
    } else if (entry.type === 'turn_end') {
      if (open) closeOpen(false);
      currentTurnId = null;
    }

    if (DELTA_TYPES.has(entry.type)) {
      if (open && sameStreamGroup(open, entry)) {
        open.text += deltaText(entry);
        open.chunks.push(entry);
        open.endTs = entry.ts;
        open.endSeq = entry.seq;
      } else {
        closeOpen(false);
        open = {
          type: entry.type,
          turnId: entry.turnId,
          text: deltaText(entry),
          chunks: [entry],
          startTs: entry.ts,
          endTs: entry.ts,
          startSeq: entry.seq,
          endSeq: entry.seq
        };
      }
      continue;
    }

    if (open) {
      const supersededBy = SUPERSEDING_TYPES[open.type];
      if (supersededBy && entry.type === supersededBy) {
        const entryTurn = turnId ?? entry.turnId ?? currentTurnId;
        const sameTurn =
          open.turnId == null || entryTurn === open.turnId || currentTurnId === open.turnId;
        if (sameTurn) {
          open = null;
          result.push({
            kind: 'single',
            id: `single:${entry.ts}:${entry.seq}:${entry.type}`,
            entry
          });
          continue;
        }
      }
      closeOpen(false);
    }

    result.push({
      kind: 'single',
      id: `single:${entry.ts}:${entry.seq}:${entry.type}`,
      entry
    });
  }

  if (open) {
    closeOpen(activeTurn != null && open.turnId === activeTurn);
  }

  return result;
}

export function transcriptViewTypeGroup(item: TranscriptViewEntry): string {
  if (item.kind === 'stream') {
    if (item.type === 'message_delta') return 'stream';
    if (item.type === 'reasoning_delta' || item.type === 'planning_delta') return 'llm';
    if (item.type.startsWith('coding_executor')) return 'coding';
    return 'stream';
  }
  return transcriptTypeGroup(item.entry.type);
}
