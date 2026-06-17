import {
  shutdown,
  completeShutdownAnimation,
  waitForShutdownAnimation
} from '$lib/stores/os';
import { isTauriShell } from './browser';

const BROWSER_CLOSE_GRACE_MS = 200;

/** Quit the desktop shell (Tauri) or close the browser tab. */
export async function exitVisionOS(): Promise<void> {
  if (isTauriShell()) {
    shutdown.set(true);
    await waitForShutdownAnimation();

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch (err) {
      console.error('Failed to close Tauri window:', err);
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('exit_app');
    } catch (err) {
      console.error('Failed to exit Tauri app:', err);
      completeShutdownAnimation();
    }
    return;
  }

  window.close();

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, BROWSER_CLOSE_GRACE_MS);
  });

  if (!document.hidden) {
    shutdown.set(true);
  }
}
