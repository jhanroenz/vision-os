<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { dialogPrompt, dialogConfirm } from '$lib/stores/dialogs';
  import { conversations } from '$lib/stores/conversations';
  import { chatSession, type ComposerMode } from '$lib/stores/chatSession';
  import { openConversationTranscript, openConversationWorkspace } from '$lib/apps/registry';
  import ChatMessageContent from '$lib/components/chat/ChatMessageContent.svelte';
  import 'highlight.js/styles/github-dark.min.css';
  import '$lib/styles/chat.css';

  interface Props {
    windowId?: string;
    initialConversationId?: string;
    initialComposerMode?: ComposerMode;
  }

  let { initialConversationId = '', initialComposerMode }: Props = $props();

  let selectedConversationId = $state('');
  let input = $state('');
  let threadScrollEl = $state<HTMLDivElement | null>(null);
  let composerInputEl = $state<HTMLTextAreaElement | null>(null);
  let stickToBottom = $state(true);
  let wasStreaming = $state(false);
  let prevShellWaiting = $state(false);
  let lastScrollSignature = $state('');

  const SCROLL_BOTTOM_THRESHOLD = 80;

  const modeLabels: Record<ComposerMode, string> = {
    chat: 'Agent',
    ask: 'Ask',
    command: 'Command',
    appBuilder: 'App Builder'
  };

  const composerPlaceholder = $derived(
    session?.composerMode === 'appBuilder'
      ? 'Describe the app you want…'
      : 'Message Jarvis...'
  );

  const session = $derived(
    selectedConversationId
      ? ($chatSession[selectedConversationId] ?? {
          loading: false,
          streaming: false,
          error: null,
          composerMode: 'chat',
          activityPhase: '',
          shellWaiting: false,
          currentAction: '',
          executionStack: [],
          executionStackProfile: 'chat',
          taskPlan: null,
          messageQueue: [],
          messages: [],
          activityLog: [],
          streamText: ''
        })
      : null
  );

  const showStreamingBubble = $derived(
    Boolean(session?.streamText && session.executionStackProfile === 'chat')
  );

  const showAgentTurn = $derived(
    Boolean(
      session &&
        (session.shellWaiting ||
          (session.streaming &&
            (session.executionStackProfile !== 'chat' ||
              !session.streamText ||
              session.activityLog.length > 0)))
    )
  );

  const agentStatus = $derived(
    session?.activityPhase || session?.currentAction || (session?.streaming ? 'Thinking...' : '')
  );

  const selectedConversation = $derived(
    $conversations.items.find((item) => resolveId(item) === selectedConversationId) ?? null
  );

  function resolveId(item: { id?: unknown; conversationId?: unknown; threadId?: unknown }): string {
    if (typeof item.id === 'string') return item.id;
    if (typeof item.conversationId === 'string') return item.conversationId;
    if (typeof item.threadId === 'string') return item.threadId;
    return '';
  }

  function authorLabel(role: string): string {
    return role === 'user' ? 'You' : 'Jarvis';
  }

  function onThreadScroll() {
    if (!threadScrollEl) return;
    const distanceFromBottom =
      threadScrollEl.scrollHeight - threadScrollEl.scrollTop - threadScrollEl.clientHeight;
    stickToBottom = distanceFromBottom < SCROLL_BOTTOM_THRESHOLD;
  }

  async function scrollThreadToBottom(force = false) {
    if (!threadScrollEl || (!force && !stickToBottom)) return;
    await tick();
    threadScrollEl.scrollTop = threadScrollEl.scrollHeight;
  }

  async function focusComposer() {
    await tick();
    composerInputEl?.focus({ preventScroll: true });
  }

  function threadScrollSignature(): string {
    if (!session) return '';
    const lastMessage = session.messages.at(-1);
    const lastActivity = session.activityLog.at(-1);
    return [
      session.loading ? 1 : 0,
      session.messages.length,
      lastMessage?.content?.length ?? 0,
      session.streamText.length,
      session.activityLog.length,
      lastActivity?.text?.length ?? 0,
      session.activityPhase,
      session.currentAction,
      session.streaming ? 1 : 0,
      showStreamingBubble ? 1 : 0,
      showAgentTurn ? 1 : 0
    ].join('|');
  }

  function applyInitialComposerMode(conversationId: string) {
    if (!initialComposerMode) return;
    chatSession.setComposerMode(conversationId, initialComposerMode);
  }

  async function selectConversation(id: string) {
    const normalized = String(id ?? '').trim();
    if (!normalized) return;
    selectedConversationId = normalized;
    stickToBottom = true;
    wasStreaming = false;
    prevShellWaiting = false;
    lastScrollSignature = '';
    await chatSession.load(normalized);
    applyInitialComposerMode(normalized);
    await scrollThreadToBottom(true);
    await focusComposer();
  }

  async function createConversation() {
    const created = await conversations.createConversation();
    if (!created) return;
    await conversations.loadList();
    await selectConversation(String(created.id ?? ''));
  }

  async function renameConversation(id: string, currentTitle: string) {
    const title = await dialogPrompt({
      title: 'Rename conversation',
      label: 'Title',
      defaultValue: currentTitle,
      confirmLabel: 'Rename'
    });
    if (!title) return;
    await conversations.renameConversation(id, title);
  }

  async function deleteConversation(id: string) {
    const ok = await dialogConfirm({
      title: 'Delete conversation',
      message: 'Delete this conversation permanently?',
      confirmLabel: 'Delete',
      destructive: true
    });
    if (!ok) return;
    await conversations.deleteConversation(id);
    if (selectedConversationId === id) {
      const next = $conversations.items[0];
      if (next) await selectConversation(resolveId(next));
      else selectedConversationId = '';
    }
  }

  async function send() {
    if (!selectedConversationId || !session) return;
    const message = input.trim();
    if (!message) return;
    input = '';
    await chatSession.send(selectedConversationId, message, session.composerMode);
  }

  onMount(async () => {
    await conversations.loadList();
    const preferred = String(initialConversationId ?? '').trim();
    if (preferred) {
      await selectConversation(preferred);
      return;
    }
    const first = $conversations.items[0];
    if (first) await selectConversation(resolveId(first));
  });

  $effect(() => {
    const preferred = String(initialConversationId ?? '').trim();
    if (!preferred || preferred === selectedConversationId) return;
    void selectConversation(preferred);
  });

  $effect(() => {
    if (!initialComposerMode || !selectedConversationId) return;
    chatSession.setComposerMode(selectedConversationId, initialComposerMode);
  });

  $effect(() => {
    selectedConversationId;
    stickToBottom = true;
    wasStreaming = false;
    prevShellWaiting = false;
    lastScrollSignature = '';
  });

  $effect(() => {
    if (!session || !selectedConversationId) return;
    const signature = threadScrollSignature();
    if (signature === lastScrollSignature) return;
    lastScrollSignature = signature;
    void scrollThreadToBottom();
  });

  $effect(() => {
    if (!session) {
      wasStreaming = false;
      prevShellWaiting = false;
      return;
    }

    const streaming = session.streaming;
    if (wasStreaming && !streaming) {
      stickToBottom = true;
      void (async () => {
        await scrollThreadToBottom(true);
        await focusComposer();
      })();
    }
    wasStreaming = streaming;

    const shellWaiting = session.shellWaiting;
    if (shellWaiting && !prevShellWaiting) {
      void focusComposer();
    }
    prevShellWaiting = shellWaiting;
  });
</script>

<div class="app-chat-unified">
  <aside class="chat-unified-sidebar">
    <div class="chat-sidebar-header">
      <h3>Chats</h3>
      <button class="btn-primary chat-sidebar-new" onclick={() => void createConversation()}>+ New</button>
    </div>

    {#if $conversations.loading}
      <p class="chat-sidebar-empty">Loading...</p>
    {:else if $conversations.items.length === 0}
      <p class="chat-sidebar-empty">No conversations yet.</p>
    {:else}
      <div class="chat-conversation-list">
        {#each $conversations.items as item (resolveId(item))}
          <div class="chat-conv-item" class:active={selectedConversationId === resolveId(item)}>
            <button class="chat-conv-open" onclick={() => void selectConversation(resolveId(item))}>
              <span class="chat-conv-title">{item.title}</span>
              <span class="chat-conv-preview">{item.preview || 'No messages yet'}</span>
            </button>
            <div class="chat-conv-actions">
              <button
                class="chat-conv-action"
                title="Rename"
                onclick={() => renameConversation(resolveId(item), item.title)}
              >
                ✎
              </button>
              <button
                class="chat-conv-action danger"
                title="Delete"
                onclick={() => deleteConversation(resolveId(item))}
              >
                ×
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </aside>

  <section class="chat-unified-main">
    {#if !selectedConversationId || !session}
      <div class="chat-main-empty">Select or create a conversation to start chatting.</div>
    {:else}
      <header class="chat-main-header">
        <h2 class="chat-main-title">{selectedConversation?.title ?? 'Conversation'}</h2>
        <div class="chat-main-actions">
          <button
            class="chat-toolbar-btn"
            title="View debug transcript for this conversation"
            onclick={() => openConversationTranscript(selectedConversationId)}
          >
            Transcript
          </button>
          <button
            class="chat-toolbar-btn"
            title="Open conversation workspace"
            onclick={() => openConversationWorkspace(selectedConversationId)}
          >
            Workspace
          </button>
        </div>
      </header>

      <div class="chat-thread-scroll" bind:this={threadScrollEl} onscroll={onThreadScroll}>
        <div class="chat-thread">
          {#if session.loading}
            <p class="chat-loading-hint">Loading conversation...</p>
          {:else if session.messages.length === 0 && !showStreamingBubble && !showAgentTurn}
            <div class="chat-empty">
              <div class="chat-empty-icon" aria-hidden="true">◎</div>
              <h2>What can Jarvis help with?</h2>
              <p>
                Ask the agent anything, or switch the composer to
                <strong>Command</strong> to run shell commands directly.
              </p>
            </div>
          {:else}
            {#each session.messages as message (message.id)}
              <article
                class="chat-message-row"
                class:user={message.role === 'user'}
                class:assistant={message.role !== 'user'}
              >
                <div class="chat-message-avatar" aria-hidden="true">
                  {message.role === 'user' ? '◉' : '◎'}
                </div>
                <div class="chat-message-body">
                  <div class="chat-message-meta">
                    <span class="chat-message-author">{authorLabel(message.role)}</span>
                  </div>
                  {#if message.role === 'user'}
                    <div class="chat-message-bubble">{message.content}</div>
                  {:else}
                    <div class="chat-message-bubble chat-message-bubble--markdown">
                      <ChatMessageContent content={message.content} markdown />
                    </div>
                  {/if}
                </div>
              </article>
            {/each}
          {/if}

          {#if showStreamingBubble}
            <article class="chat-message-row assistant streaming">
              <div class="chat-message-avatar" aria-hidden="true">◎</div>
              <div class="chat-message-body">
                <div class="chat-message-meta">
                  <span class="chat-message-author">Jarvis</span>
                </div>
                <div class="chat-message-bubble chat-message-bubble--markdown" class:streaming={session.streaming}>
                  <ChatMessageContent content={session.streamText} markdown />
                  {#if session.streaming}
                    <span class="chat-stream-cursor" aria-hidden="true"></span>
                  {/if}
                </div>
              </div>
            </article>
          {/if}

          {#if showAgentTurn}
            <article class="chat-message-row assistant agent-turn">
              <div class="chat-message-avatar" aria-hidden="true">◎</div>
              <div class="chat-message-body">
                <div class="chat-agent-activity">
                  <div class="chat-agent-status">
                    {#if session.streaming}
                      <span class="chat-thinking-dots" aria-hidden="true">
                        <span></span><span></span><span></span>
                      </span>
                    {/if}
                    <span>{agentStatus || 'Working...'}</span>
                  </div>
                  {#if session.activityLog.length > 0}
                    <ul class="chat-agent-actions">
                      {#each session.activityLog.slice(-8) as item (item.id)}
                        <li class="chat-agent-action chat-agent-action-{item.type}">{item.text}</li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              </div>
            </article>
          {/if}
        </div>
      </div>

      <footer class="chat-composer">
        <div class="chat-composer-inner">
          {#if session.error}
            <p class="chat-error">{session.error}</p>
          {/if}
          {#if session.shellWaiting}
            <div class="chat-shell-banner">
              Interactive command is waiting for input. Your next message goes directly to the shell.
            </div>
          {/if}
          <div class="chat-composer-box">
            <textarea
              class="chat-composer-input"
              bind:this={composerInputEl}
              bind:value={input}
              placeholder={composerPlaceholder}
              rows="2"
              onkeydown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            ></textarea>
            <div class="chat-composer-actions">
              <select
                class="chat-mode-select"
                value={session.composerMode}
                disabled={session.shellWaiting}
                onchange={(e) =>
                  chatSession.setComposerMode(selectedConversationId, e.currentTarget.value as ComposerMode)}
              >
                {#each Object.entries(modeLabels) as [value, label]}
                  <option value={value}>{label}</option>
                {/each}
              </select>
              <button
                class="chat-send-btn"
                disabled={session.streaming}
                onclick={() => void send()}
              >
                {session.streaming ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
          <p class="chat-composer-hint">Jarvis can make mistakes. Verify important changes.</p>
        </div>
      </footer>
    {/if}
  </section>
</div>
