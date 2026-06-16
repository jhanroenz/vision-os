import {
  shutdown,
  completeShutdownAnimation,
  waitForShutdownAnimation
} from '$lib/stores/os';
import { isTauri } from './browser';

const BROWSER_CLOSE_GRACE_MS = 200;

/** Quit the desktop shell (Tauri) or close the browser tab. */
export async function exitVisionOS(): Promise<void> {
  if (isTauri()) {
    try {
      shutdown.set(true);
      await waitForShutdownAnimation();
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
      return;
    } catch (err) {
      console.error('Failed to exit Tauri app:', err);
      completeShutdownAnimation();
      shutdown.set(true);
      return;
    }
  }

  window.close();

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, BROWSER_CLOSE_GRACE_MS);
  });

  // Most browsers block window.close() unless this tab was script-opened.
  if (!document.hidden) {
    shutdown.set(true);
  }
}
