import { config } from '../config.js';
import { detectProviderFromBaseUrl, probeLlmHealth } from '../llmProviders.js';
import { json } from '../http.js';

export async function GET() {
  let llmOk = false;
  let searxngOk = false;

  try {
    const provider = config.llm.provider ?? detectProviderFromBaseUrl(config.llm.baseURL);
    llmOk = await probeLlmHealth(provider);
  } catch {
    llmOk = false;
  }

  try {
    const searchUrl = new URL('/search', config.searxng.apiBase);
    searchUrl.searchParams.set('q', 'test');
    searchUrl.searchParams.set('format', 'json');
    const response = await fetch(searchUrl, {
      method: 'GET',
      headers: config.searxng.headers,
      signal: AbortSignal.timeout(5000)
    });
    searxngOk = response.ok;
  } catch {
    searxngOk = false;
  }

  const searchOptional = process.env.SEARXNG_OPTIONAL === 'true';
  const ok = searchOptional ? llmOk : llmOk && searxngOk;

  return json(
    {
      ok,
      llm: llmOk,
      searxng: searxngOk,
      searchOptional,
      searchAvailable: searxngOk,
      model: config.llm.model,
      provider: config.llm.provider ?? detectProviderFromBaseUrl(config.llm.baseURL),
      baseURL: config.llm.baseURL,
      context: config.llm.context,
      workspace: config.workspaceDir,
      searchProvider: 'searxng',
      searxngUrl: config.searxng.apiBase
    },
    ok ? 200 : 503
  );
}
