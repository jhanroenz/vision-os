/** Client-only xterm loader — import ESM builds directly for reliable Vite interop. */

export async function loadXterm() {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import('@xterm/xterm/lib/xterm.mjs'),
    import('@xterm/addon-fit/lib/addon-fit.mjs')
  ]);

  if (!Terminal || !FitAddon) {
    throw new Error('Failed to load xterm.js modules');
  }

  return { Terminal, FitAddon };
}
