<script lang="ts">
  import { onMount } from 'svelte';
  import { chatSession, type ComposerMode } from '$lib/stores/chatSession';
  import { openConversationTranscript, openConversationWorkspace } from '$lib/apps/registry';

  interface Props {
    conversationId: string;
    windowId?: string;
  }

  let { conversationId }: Props = $props();
  let input = $state('');
  const modeLabels: Record<ComposerMode, string> = {
    chat: 'Agent',
    ask: 'Ask',
    research: 'Research',
    command: 'Command',
    appBuilder: 'App Builder'
  };

  onMount(() => {
    if (!conversationId) return;
    void chatSession.load(conversationId);
  });

  const session = $derived(
    $chatSession[conversationId] ?? {
      loading: false,
      streaming: false,
      error: null,
      composerMode: 'chat',
      activityPhase: '',
      shellWaiting: false,
      currentAction: '',
      executionStackProfile: 'chat',
      executionStack: [],
      taskPlan: null,
      messageQueue: [],
      messages: [],
      eventLog: [],
      streamText: ''
    }
  );

  async function send() {
    const message = input.trim();
    if (!message) return;
    input = '';
    await chatSession.send(conversationId, message, session.composerMode);
  }
</script>

<div class="app-conversation">
  {#if !conversationId}
    <p class="settings-error">This window needs a conversation context. Open a conversation from the Chat app.</p>
  {:else}
  <header class="conversation-toolbar">
    <span class="settings-hint">Conversation: {conversationId}</span>
    <span class="settings-hint">{session.activityPhase || session.currentAction || 'Idle'}</span>
    <div class="conversation-toolbar-actions">
      <select
        value={session.composerMode}
        onchange={(e) => chatSession.setComposerMode(conversationId, e.currentTarget.value as ComposerMode)}
      >
        {#each Object.entries(modeLabels) as [value, label]}
          <option value={value}>{label}</option>
        {/each}
      </select>
      <button class="btn-secondary" onclick={() => openConversationWorkspace(conversationId)}>
        Open Workspace
      </button>
      <button class="btn-secondary" onclick={() => openConversationTranscript(conversationId)}>
        Open Transcript
      </button>
      {#if session.shellWaiting}
        <button class="btn-danger" onclick={() => void chatSession.cancelShell(conversationId)}>
          Cancel command
        </button>
      {/if}
    </div>
  </header>

  <div class="conversation-main-grid">
    <div class="conversation-messages">
      {#if session.shellWaiting}
        <div class="conversation-shell-waiting">
          Interactive command is waiting for input. Your next message will be sent to that shell.
        </div>
      {/if}
      {#if session.messageQueue.length > 0}
        <div class="conversation-queue">
          <strong>{session.messageQueue.length} queued</strong>
          <button class="btn-secondary" onclick={() => chatSession.clearMessageQueue(conversationId)}>
            Clear queue
          </button>
        </div>
      {/if}
      {#if session.loading}
        <p class="settings-hint">Loading conversation...</p>
      {:else if session.messages.length === 0}
        <p class="settings-hint">No messages yet.</p>
      {:else}
        {#each session.messages as message (message.id)}
          <div class="conversation-message" class:conversation-user={message.role === 'user'}>
            <strong>{message.role}</strong>
            <p>{message.content}</p>
          </div>
        {/each}
      {/if}
      {#if session.streamText}
        <div class="conversation-message conversation-assistant-stream">
          <strong>assistant (streaming)</strong>
          <p>{session.streamText}</p>
        </div>
      {/if}
    </div>

    <aside class="conversation-activity-panel">
      <h4>Activity</h4>
      {#if session.executionStack.length > 0 && session.executionStackProfile !== 'chat'}
        <ol class="conversation-execution-stack">
          {#each session.executionStack as phase (phase.id)}
            <li class={`stack-${phase.status}`}>{phase.label}</li>
          {/each}
        </ol>
      {/if}
      {#if session.taskPlan?.steps?.length}
        <div class="conversation-task-plan">
          <strong>{session.taskPlan.title || 'Task plan'}</strong>
          {#each session.taskPlan.steps as step (step.id)}
            <div class={`task-step task-${step.status}`}>{step.label}</div>
          {/each}
        </div>
      {/if}
      {#if session.activityLog.length === 0}
        <p class="settings-hint">No activity yet.</p>
      {:else}
        <div class="conversation-activity-list">
          {#each session.activityLog as item (item.id)}
            <div class="conversation-activity-item">
              <strong>{item.type}</strong>
              <div>{item.text}</div>
              {#if item.detail}
                <pre>{item.detail}</pre>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </aside>
  </div>

  {#if session.error}
    <p class="settings-error">{session.error}</p>
  {/if}

  <footer class="conversation-input-row">
    <textarea
      bind:value={input}
      placeholder="Send a message..."
      onkeydown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          void send();
        }
      }}
    ></textarea>
    <button class="btn-primary" disabled={session.streaming} onclick={() => void send()}>
      {session.streaming ? 'Sending...' : 'Send'}
    </button>
  </footer>
  {/if}
</div>
