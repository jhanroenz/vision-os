import { apiFetch, resolveApiUrl } from './http.js';

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
  return apiFetch<T>(url, init);
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
  return resolveApiUrl(`/api/conversations/${encode(conversationId)}/transcript/download`);
}
