export interface TranscriptMeta {
  path: string;
  totalLines: number;
  updatedAt: string | null;
  turnFiles: string[];
  activeTurn?: string | null;
}

export interface TranscriptRecord {
  ts: string;
  conversationId: string;
  turnId: string | null;
  seq: number | null;
  type: string;
  data: Record<string, unknown>;
}

export interface TranscriptEntriesResponse {
  conversationId: string;
  path: string;
  totalLines: number;
  entries: TranscriptRecord[];
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

function encode(id: string) {
  return encodeURIComponent(id);
}

export async function getTranscriptMeta(conversationId: string): Promise<TranscriptMeta> {
  return api(`/api/conversations/${encode(conversationId)}/transcript/meta`);
}

export async function getTranscriptEntries(
  conversationId: string,
  options?: { tail?: number; turnFile?: string }
): Promise<TranscriptEntriesResponse> {
  const params = new URLSearchParams();
  if (options?.tail != null) params.set('tail', String(options.tail));
  if (options?.turnFile) params.set('turnFile', options.turnFile);
  const suffix = params.size ? `?${params.toString()}` : '';
  return api(`/api/conversations/${encode(conversationId)}/transcript${suffix}`);
}

export function getTranscriptDownloadUrl(conversationId: string): string {
  return `/api/conversations/${encode(conversationId)}/transcript/download`;
}
