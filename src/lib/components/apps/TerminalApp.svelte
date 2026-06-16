<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import '@xterm/xterm/css/xterm.css';
  import { loadXterm } from '$lib/terminal/xterm';
  import {
    spawnTerminal,
    sendTerminalInput,
    resizeTerminal,
    closeTerminal,
    connectTerminalStream
  } from '$lib/terminal/client';

  interface Props {
    windowId?: string;
  }

  let { windowId }: Props = $props();

  let containerEl: HTMLDivElement | undefined = $state();
  let status = $state('Connecting…');
  let sessionId = $state<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let term: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fitAddon: any = null;
  let stream: EventSource | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let booted = false;
  let cleanup: (() => void) | undefined;

  async function syncSize() {
    if (!term || !fitAddon || !sessionId) return;
    fitAddon.fit();
    const cols = Math.max(term.cols, 2);
    const rows = Math.max(term.rows, 2);
    await resizeTerminal(sessionId, cols, rows);
  }

  async function bootTerminal(el: HTMLDivElement) {
    status = 'Loading terminal…';

    const { Terminal, FitAddon } = await loadXterm();

    term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#6c5ce7',
        selectionBackground: 'rgba(108, 92, 231, 0.35)'
      },
      allowProposedApi: true
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);

    // Wait for window layout before fitting dimensions.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    fitAddon.fit();

    const cols = Math.max(term.cols, 80);
    const rows = Math.max(term.rows, 24);

    status = 'Starting shell…';
    const session = await spawnTerminal(cols, rows);
    sessionId = session.id;
    status = `${session.shell} — ${session.cwd}`;

    term.onData((data: string) => {
      if (sessionId) void sendTerminalInput(sessionId, data);
    });

    stream = connectTerminalStream(session.id, {
      onReady(info) {
        status = `${info.shell} — ${info.cwd}`;
      },
      onOutput(data) {
        term?.write(data);
      },
      onExit(code) {
        term?.writeln(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m`);
        status = `Exited (${code})`;
      },
      onError(message) {
        if (status.startsWith('Exited')) return;
        term?.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
        status = message;
      }
    });

    resizeObserver = new ResizeObserver(() => {
      void syncSize();
    });
    resizeObserver.observe(el);
    term.focus();
  }

  $effect(() => {
    if (!browser) return;
    const el = containerEl;
    if (!el || booted) return;

    booted = true;
    let cancelled = false;

    void bootTerminal(el).catch((error) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      status = message;
      term?.writeln?.(`\x1b[31m${message}\x1b[0m`);
    });

    cleanup = () => {
      cancelled = true;
      resizeObserver?.disconnect();
      stream?.close();
      if (sessionId) closeTerminal(sessionId);
      term?.dispose();
    };

    return () => cleanup?.();
  });

  onDestroy(() => cleanup?.());
</script>

<div class="terminal-app terminal-app--real">
  <div class="terminal-statusbar" title={status}>{status}</div>
  <div class="terminal-xterm" bind:this={containerEl}></div>
</div>
