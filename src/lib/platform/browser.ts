import { PACKAGED_BACKEND_PORT } from '$lib/config/packaged';

/** True when running inside the Tauri desktop shell. */
export function isTauriShell(): boolean {
  if (typeof window === 'undefined') return false;
  if ('__TAURI_INTERNALS__' in window) return true;
  if ('__TAURI__' in window) return true;
  // Packaged builds load the UI from the bundled Node backend URL.
  return (
    window.location.protocol === 'http:' &&
    window.location.hostname === '127.0.0.1' &&
    window.location.port === String(PACKAGED_BACKEND_PORT)
  );
}

/** Packaged release serves the UI from the embedded backend port (not Vite). */
export function isPackagedTauriShell(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    isTauriShell() &&
    window.location.hostname === '127.0.0.1' &&
    window.location.port === String(PACKAGED_BACKEND_PORT)
  );
}

/**
 * Release Tauri shows startup-boot.html in Rust before the main UI loads.
 * Dev Tauri does the same, then navigates to the Vite dev server.
 */
export function shouldSkipSvelteBootScreen(): boolean {
  return isTauriShell();
}

/** @deprecated Use isTauriShell */
export function isTauri(): boolean {
  return isTauriShell();
}

/**
 * Open a URL in a dedicated Chromium webview window (Tauri desktop)
 * or fall back to a system browser tab (web).
 */
export async function openBrowserWindow(
  url: string,
  title = 'Browser'
): Promise<'webview' | 'tab' | 'failed'> {
  if (isTauriShell()) {
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
