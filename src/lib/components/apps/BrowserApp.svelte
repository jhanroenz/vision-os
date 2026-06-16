<script lang="ts">
  import { openBrowserWindow } from '$lib/platform/browser';

  interface Props {
    windowId?: string;
  }

  let { windowId }: Props = $props();

  const pages: Record<string, string> = {
    'visionos://home': `<!DOCTYPE html><html><head><style>
    body{font-family:system-ui;background:#1a1f2e;color:#e8ecf4;margin:0;padding:40px;line-height:1.6}
    h1{color:#6c5ce7} .card{background:rgba(255,255,255,0.05);padding:20px;border-radius:12px;margin:16px 0}
    a{color:#6c5ce7;cursor:pointer}</style></head><body>
    <h1>◎ Vision Browser</h1>
    <div class="card"><h3>Welcome!</h3><p>Internal pages load here. External URLs open in a real Chromium window (desktop) or system tab (web).</p></div>
    <div class="card"><h3>Quick Links</h3>
    <p><a href="visionos://about">About VisionOS</a></p>
    <p><a href="visionos://help">Browser Help</a></p>
    <p><a href="https://en.wikipedia.org/wiki/Web_browser">Wikipedia</a></p>
    </div></body></html>`,

    'visionos://about': `<!DOCTYPE html><html><head><style>
    body{font-family:system-ui;background:#0f1525;color:#e8ecf4;margin:0;padding:40px;line-height:1.6}
    h1{color:#3ecf8e}</style></head><body>
    <h1>About VisionOS</h1>
    <p>VisionOS is the Jarvis desktop shell — SvelteKit frontend + backend, packaged with Tauri.</p>
    </body></html>`,

    'visionos://help': `<!DOCTYPE html><html><head><style>
    body{font-family:system-ui;background:#1a1030;color:#e8ecf4;margin:0;padding:40px;line-height:1.8}
    code{background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px}</style></head><body>
    <h1>Browser Help</h1>
    <p><code>visionos://</code> pages load in this panel.</p>
    <p><code>https://</code> URLs open in a dedicated Chromium webview (desktop) or new browser tab (web).</p>
    </body></html>`
  };

  let frameEl: HTMLIFrameElement | undefined = $state();
  let url = $state('visionos://home');
  let history = $state<string[]>(['visionos://home']);
  let historyIndex = $state(0);
  let lastExternal = $state<string | null>(null);
  let openStatus = $state<'webview' | 'tab' | 'failed' | null>(null);

  function normalize(raw: string): string {
    let target = raw.trim();
    if (!target) return '';
    if (!target.match(/^[a-z]+:\/\//i)) target = `https://${target}`;
    return target;
  }

  function isInternal(target: string) {
    return target.startsWith('visionos://');
  }

  function isExternal(target: string) {
    return /^https?:\/\//i.test(target);
  }

  function notFoundPage(target: string) {
    return `<!DOCTYPE html><html><body style="font-family:system-ui;padding:40px;background:#1a1f2e;color:#ff6b8a">
      <h2>Page not found</h2><p>${target}</p></body></html>`;
  }

  function externalPanel(target: string, status: 'webview' | 'tab' | 'failed') {
    const mode =
      status === 'webview'
        ? 'Chromium webview window'
        : status === 'tab'
          ? 'system browser tab'
          : 'browser (blocked — allow popups)';
    return `<!DOCTYPE html><html><head><style>
      body{font-family:system-ui;background:#1a1f2e;color:#e8ecf4;margin:0;padding:40px;line-height:1.7}
      h2{color:#3ecf8e;margin-top:0}
      .url{word-break:break-all;background:rgba(255,255,255,0.06);padding:12px;border-radius:8px;font-size:13px}
      .hint{color:#8b95a8;font-size:13px}
      </style></head><body>
      <h2>↗ Opened externally</h2>
      <p>Launched in ${mode}:</p>
      <div class="url">${target}</div>
      <p class="hint">Enter another URL above, or browse internal <code>visionos://</code> pages here.</p>
      </body></html>`;
  }

  function wireLinks() {
    if (!frameEl) return;
    try {
      const doc = frameEl.contentDocument;
      doc?.querySelectorAll('a[href]').forEach((a) => {
        a.addEventListener('click', (ev) => {
          const href = a.getAttribute('href');
          if (!href || href.startsWith('#')) return;
          ev.preventDefault();
          navigate(href);
        });
      });
    } catch {
      /* cross-origin */
    }
  }

  function onFrameLoad() {
    wireLinks();
  }

  function loadInternal(frame: HTMLIFrameElement, target: string) {
    frame.removeAttribute('src');
    frame.srcdoc = pages[target] ?? notFoundPage(target);
    lastExternal = null;
    openStatus = null;
  }

  async function loadExternal(frame: HTMLIFrameElement, target: string) {
    const status = await openBrowserWindow(target, 'Vision Browser');
    lastExternal = target;
    openStatus = status;
    frame.removeAttribute('src');
    frame.srcdoc = externalPanel(target, status);
  }

  async function navigate(raw: string, pushHistory = true) {
    const frame = frameEl;
    if (!frame) return;

    const target = normalize(raw);
    if (!target) return;

    if (isInternal(target)) {
      loadInternal(frame, target);
      url = target;
    } else if (isExternal(target)) {
      await loadExternal(frame, target);
      url = target;
    } else {
      frame.removeAttribute('src');
      frame.srcdoc = notFoundPage(target);
      url = target;
    }

    if (pushHistory) {
      history = [...history.slice(0, historyIndex + 1), target];
      historyIndex = history.length - 1;
    }
  }

  function goBack() {
    if (historyIndex > 0) {
      historyIndex--;
      navigate(history[historyIndex], false);
    }
  }

  function goForward() {
    if (historyIndex < history.length - 1) {
      historyIndex++;
      navigate(history[historyIndex], false);
    }
  }

  async function refresh() {
    const target = normalize(url);
    if (isExternal(target)) {
      await loadExternal(frameEl!, target);
    } else {
      navigate(target, false);
    }
  }

  $effect(() => {
    if (!frameEl) return;
    frameEl.addEventListener('load', onFrameLoad);
    navigate('visionos://home', false);
    return () => frameEl?.removeEventListener('load', onFrameLoad);
  });
</script>

<div class="browser-app">
  <div class="browser-toolbar">
    <button type="button" title="Back" onclick={goBack}>←</button>
    <button type="button" title="Forward" onclick={goForward}>→</button>
    <button type="button" title="Refresh" onclick={refresh}>↻</button>
    <button type="button" title="Home" onclick={() => navigate('visionos://home')}>🏠</button>
    <input
      class="browser-url"
      bind:value={url}
      spellcheck="false"
      placeholder="visionos://home or https://example.com"
      onkeydown={(e) => e.key === 'Enter' && navigate(url)}
    />
    <button type="button" onclick={() => navigate(url)}>Go</button>
  </div>
  <iframe
    bind:this={frameEl}
    class="browser-frame"
    title="Browser"
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
  ></iframe>
</div>
