<script lang="ts">
  import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
  import { loadJson, saveJson } from '$lib/persist';

  interface Props {
    windowId?: string;
  }

  let { windowId }: Props = $props();

  interface Todo {
    id: number;
    text: string;
    done: boolean;
  }

  let todos = $state<Todo[]>(loadJson('todos', []));
  let filter = $state<'all' | 'active' | 'done'>('all');
  let input = $state('');

  const filtered = $derived(
    todos.filter((t) => {
      if (filter === 'active') return !t.done;
      if (filter === 'done') return t.done;
      return true;
    })
  );

  const remaining = $derived(todos.filter((t) => !t.done).length);

  function persist() {
    saveJson('todos', todos);
  }

  function addTodo() {
    const text = input.trim();
    if (!text) return;
    todos = [...todos, { id: Date.now(), text, done: false }];
    input = '';
    persist();
  }

  function toggleTodo(id: number, done: boolean) {
    todos = todos.map((t) => (t.id === id ? { ...t, done } : t));
    persist();
  }

  function deleteTodo(id: number) {
    todos = todos.filter((t) => t.id !== id);
    persist();
  }

  function clearDone() {
    todos = todos.filter((t) => !t.done);
    persist();
  }
</script>

<div class="todo-app">
  <div class="todo-input-row">
    <input
      class="todo-input"
      placeholder="Add a new task..."
      bind:value={input}
      onkeydown={(e) => e.key === 'Enter' && addTodo()}
    />
    <button class="todo-add-btn" onclick={addTodo}>+</button>
  </div>
  <div class="todo-filters">
    <button class:active={filter === 'all'} onclick={() => (filter = 'all')}>All</button>
    <button class:active={filter === 'active'} onclick={() => (filter = 'active')}>Active</button>
    <button class:active={filter === 'done'} onclick={() => (filter = 'done')}>Done</button>
  </div>
  <ul class="todo-list">
    {#if filtered.length === 0}
      <li class="todo-empty">No tasks yet</li>
    {:else}
      {#each filtered as todo (todo.id)}
        <li class="todo-item" class:done={todo.done}>
          <ToggleSwitch
            checked={todo.done}
            onchange={(v) => toggleTodo(todo.id, v)}
          />
          <span class="todo-text">{todo.text}</span>
          <button class="todo-delete" title="Delete" onclick={() => deleteTodo(todo.id)}>✕</button>
        </li>
      {/each}
    {/if}
  </ul>
  <div class="todo-footer">
    <span class="todo-count">{remaining} item{remaining !== 1 ? 's' : ''} left</span>
    <button class="todo-clear-done" onclick={clearDone}>Clear completed</button>
  </div>
</div>
