import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [sveltekit()],
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1'
  },
  ssr: {
    external: ['better-sqlite3', 'node-pty', '@xterm/xterm', '@xterm/addon-fit']
  },
  optimizeDeps: {
    include: [
      '@xterm/xterm/lib/xterm.mjs',
      '@xterm/addon-fit/lib/addon-fit.mjs'
    ]
  }
});
