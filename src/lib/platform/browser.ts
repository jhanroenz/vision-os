/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Open a URL in a dedicated Chromium webview window (Tauri desktop)
 * or fall back to a system browser tab (web).
 */
export async function openBrowserWindow(
  url: string,
  title = 'Browser'
): Promise<'webview' | 'tab' | 'failed'> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_browser_window', { url, title });
      return 'webview';
    } catch (err) {
      console.error('Tauri browser window failed:', err);
    }
  }

  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  return opened ? 'tab' : 'failed';
}
