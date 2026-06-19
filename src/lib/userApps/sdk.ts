import { apiFetch } from '$lib/api/http.js';
import { openApp } from '$lib/apps/registry';

export interface SdkMessage {
  source: string;
  appId: string;
  method: string;
  args: Record<string, unknown>;
  requestId: string;
}

export async function handleSandboxSdkMessage(
  slug: string,
  message: SdkMessage,
  origin: string
): Promise<{ requestId: string; result?: unknown; error?: string }> {
  if (message.source !== 'visionos-app') {
    throw new Error('Invalid message source');
  }
  if (message.appId && message.appId !== slug) {
    throw new Error('App id mismatch');
  }

  try {
    const data = await apiFetch<{ result: unknown }>(
      `/api/user-apps/${encodeURIComponent(slug)}/sdk`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: message.method, args: message.args ?? {} })
      }
    );

    if (message.method === 'os.openApp' && data.result && typeof data.result === 'object') {
      const r = data.result as { appId?: string; props?: Record<string, unknown> };
      if (r.appId) openApp(r.appId, { props: r.props });
    }

    return { requestId: message.requestId, result: data.result };
  } catch (error) {
    return {
      requestId: message.requestId,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function postSdkResponse(
  iframe: HTMLIFrameElement | null,
  origin: string,
  payload: { requestId: string; result?: unknown; error?: string }
) {
  iframe?.contentWindow?.postMessage({ source: 'visionos-host', ...payload }, origin);
}
