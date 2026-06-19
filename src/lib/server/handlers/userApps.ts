import {
  listUserApps,
  getUserAppBySlug,
  getAppData,
  setAppData,
  deleteAppData,
  listAppJobs,
  createAppJob,
  updateAppJob,
  deleteAppJob,
  getAppJob,
} from '../userApps/repository.js';
import { syncAllUserApps } from '../userApps/scanner.js';
import { publishUserApp, uninstallUserApp } from '../userApps/publish.js';
import { serveAppAsset, getSdkClientScript } from '../userApps/serve.js';
import { normalizeAppSlug, registryIdFromSlug, publishedAppDir } from '../userApps/paths.js';
import { readManifestFromDir } from '../userApps/manifest.js';
import { handleSdkRpc } from '../userApps/sdkHandler.js';
import { handleSchemaAction } from '../userApps/schemaActions.js';
import { proxyWeatherFetch } from '../userApps/weatherProxy.js';
import { json, jsonError, readJson } from '../http.js';

function slugOrError(appId: string) {
  try {
    return normalizeAppSlug(appId);
  } catch {
    return null;
  }
}

export function list() {
  try {
    const apps = listUserApps();
    return json({ apps });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function scan() {
  try {
    const result = await syncAllUserApps();
    return json(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export function get(appId: string) {
  try {
    const slug = slugOrError(appId);
    if (!slug) return jsonError('Invalid app id', 400);
    const app = getUserAppBySlug(slug);
    if (!app) return jsonError('App not found', 404);
    return json(app);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function remove(appId: string) {
  try {
    const slug = slugOrError(appId);
    if (!slug) return jsonError('Invalid app id', 400);
    await uninstallUserApp(slug);
    return json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function publish(appId: string) {
  try {
    const slug = slugOrError(appId);
    if (!slug) return jsonError('Invalid app id', 400);
    const app = await publishUserApp(slug);
    if (!app) return jsonError('Publish failed', 500);
    return json({ app, event: { type: 'user_app_published', slug, appId: app.id } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function serve(appId: string, assetPath: string) {
  try {
    const slug = slugOrError(appId);
    if (!slug) return jsonError('Invalid app id', 400);
    return await serveAppAsset(slug, assetPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('not found') ? 404 : 403;
    return jsonError(message, status);
  }
}

export async function getData(appId: string, key: string) {
  try {
    const slug = slugOrError(appId);
    if (!slug) return jsonError('Invalid app id', 400);
    const appIdFull = registryIdFromSlug(slug);
    const row = getAppData(appIdFull, key);
    if (!row) return jsonError('Key not found', 404);
    return json(row);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function putData(appId: string, key: string, request: Request) {
  try {
    const slug = slugOrError(appId);
    if (!slug) return jsonError('Invalid app id', 400);
    const body = await readJson(request);
    const appIdFull = registryIdFromSlug(slug);
    const result = setAppData(appIdFull, key, body.value ?? body);
    return json(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function deleteData(appId: string, key: string) {
  try {
    const slug = slugOrError(appId);
    if (!slug) return jsonError('Invalid app id', 400);
    const appIdFull = registryIdFromSlug(slug);
    deleteAppData(appIdFull, key);
    return json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export function listJobsHandler(appId: string) {
  try {
    const slug = slugOrError(appId);
    if (!slug) return jsonError('Invalid app id', 400);
    const jobs = listAppJobs(registryIdFromSlug(slug));
    return json({ jobs });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function createJob(appId: string, request: Request) {
  try {
    const slug = slugOrError(appId);
    if (!slug) return jsonError('Invalid app id', 400);
    const body = await readJson<{
      name?: string;
      schedule?: string;
      handler?: string;
      payload?: unknown;
      enabled?: boolean;
    }>(request);
    const job = createAppJob({
      appId: registryIdFromSlug(slug),
      name: String(body.name ?? 'job'),
      schedule: String(body.schedule ?? 'interval:60000'),
      handler: String(body.handler ?? 'agent_prompt'),
      payload: (body.payload as Record<string, unknown> | null | undefined) ?? null,
      enabled: body.enabled !== false
    });
    return json(job);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function patchJob(appId: string, jobId: string, request: Request) {
  try {
    const slug = slugOrError(appId);
    if (!slug) return jsonError('Invalid app id', 400);
    const body = await readJson(request);
    const job = updateAppJob(registryIdFromSlug(slug), jobId, body);
    if (!job) return jsonError('Job not found', 404);
    return json(job);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function removeJob(appId: string, jobId: string) {
  try {
    const slug = slugOrError(appId);
    if (!slug) return jsonError('Invalid app id', 400);
    deleteAppJob(registryIdFromSlug(slug), jobId);
    return json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export function getJobHandler(appId: string, jobId: string) {
  try {
    const slug = slugOrError(appId);
    if (!slug) return jsonError('Invalid app id', 400);
    const job = getAppJob(registryIdFromSlug(slug), jobId);
    if (!job) return jsonError('Job not found', 404);
    return json(job);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function sdk(appId: string, request: Request) {
  try {
    const slug = slugOrError(appId);
    if (!slug) return jsonError('Invalid app id', 400);
    const body = await readJson<{ method?: string; args?: Record<string, unknown> }>(request);
    const method = String(body.method ?? '');
    if (!method) return jsonError('method is required', 400);

    const manifest = await readManifestFromDir(publishedAppDir(slug));
    const result = await handleSdkRpc(slug, manifest, method, body.args ?? {});
    return json({ result });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function schemaAction(appId: string, request: Request) {
  try {
    const slug = slugOrError(appId);
    if (!slug) return jsonError('Invalid app id', 400);
    const body = await readJson<{ action?: string; payload?: Record<string, unknown> }>(request);
    const manifest = await readManifestFromDir(publishedAppDir(slug));
    const result = await handleSchemaAction(
      slug,
      manifest,
      String(body.action ?? ''),
      body.payload ?? {}
    );
    return json(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function weatherFetch(appId: string, targetUrl: string | null) {
  try {
    const slug = slugOrError(appId);
    if (!slug) return jsonError('Invalid app id', 400);
    if (!targetUrl) return jsonError('url query parameter is required', 400);
    return await proxyWeatherFetch(targetUrl);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function sdkScript() {
  try {
    const script = await getSdkClientScript();
    return new Response(script, {
      headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}
