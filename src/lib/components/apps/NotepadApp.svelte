<script lang="ts">
  import { onMount } from 'svelte';
  import { WorkspaceFS, normalizeWorkspacePath } from '$lib/api/workspace';
  import { windows } from '$lib/stores/windows';
  import { dialogAlert, dialogPrompt } from '$lib/stores/dialogs';

  interface Props {
    windowId?: string;
    filePath?: string;
  }

  let { windowId, filePath }: Props = $props();

  let editorEl: HTMLTextAreaElement | undefined = $state();
  let text = $state('');
  let status = $state('Line 1, Col 1');
  let currentFile = $state<string | null>(null);

  onMount(async () => {
    currentFile = filePath ? normalizeWorkspacePath(filePath) : null;
    if (filePath) {
      try {
        const content = await WorkspaceFS.readText(filePath);
        if (content !== null) text = content;
        setTitle(`${filePath.split('/').pop()} - Notepad`);
      } catch {
        status = 'Could not open file';
      }
    }
    updateStatus();
  });

  function updateStatus() {
    const el = editorEl;
    if (!el) return;
    const pos = el.selectionStart;
    const before = text.substring(0, pos);
    const lines = before.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    status = `Line ${line}, Col ${col}  |  ${text.length} chars  |  ${words} words`;
  }

  function setTitle(title: string) {
    if (windowId) windows.setTitle(windowId, title);
  }

  function handleNew() {
    text = '';
    currentFile = null;
    setTitle('Notepad');
    updateStatus();
  }

  async function handleOpen() {
    const path = await dialogPrompt({
      title: 'Open file',
      message: 'Enter a workspace path relative to your projects folder.',
      label: 'File path',
      placeholder: 'workspace/visionos/README.md',
      confirmLabel: 'Open'
    });
    if (!path) return;
    try {
      const content = await WorkspaceFS.readText(path);
      if (content === null) {
        await dialogAlert({
          title: 'Cannot open file',
          message: 'This file is binary or not readable as text.'
        });
        return;
      }
      text = content;
      currentFile = normalizeWorkspacePath(path);
      setTitle(`${path.split('/').pop()} - Notepad`);
      updateStatus();
    } catch {
      await dialogAlert({
        title: 'File not found',
        message: 'Check the path and try again.'
      });
    }
  }

  async function handleSave(asNew = false) {
    let path = currentFile;
    if (asNew || !path) {
      const input = await dialogPrompt({
        title: asNew ? 'Save as' : 'Save file',
        message: 'Enter a workspace path for this file.',
        label: 'File path',
        defaultValue: path ?? 'notes.txt',
        placeholder: 'notes.txt or docs/notes.txt',
        confirmLabel: 'Save'
      });
      if (!input) return;
      path = normalizeWorkspacePath(input);
    }
    try {
      await WorkspaceFS.write(path, text);
      currentFile = path;
      setTitle(`${path.split('/').pop()} - Notepad`);
      status = `Saved to ${path}`;
      setTimeout(updateStatus, 2000);
    } catch {
      await dialogAlert({
        title: 'Save failed',
        message: 'Could not write the file. Check the path and permissions.'
      });
    }
  }
</script>

<div class="notepad-app">
  <div class="notepad-toolbar">
    <button onclick={handleNew}>New</button>
    <button onclick={handleOpen}>Open</button>
    <button onclick={() => handleSave(false)}>Save</button>
    <button onclick={() => handleSave(true)}>Save As</button>
  </div>
  <textarea
    bind:this={editorEl}
    class="notepad-editor"
    placeholder="Start typing..."
    bind:value={text}
    oninput={updateStatus}
    onclick={updateStatus}
    onkeyup={updateStatus}
  ></textarea>
  <div class="notepad-status">{status}</div>
</div>
