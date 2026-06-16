<script setup>
import { ref, computed } from "vue";

const newTodo = ref("");
const todos = ref([
  { id: 1, text: "Learn Vue 3 reactivity", done: false },
  { id: 2, text: "Build a todo app", done: true },
]);

const remaining = computed(() => todos.value.filter((t) => !t.done).length);

function addTodo() {
  const text = newTodo.value.trim();
  if (!text) return;
  todos.value.push({
    id: Date.now(),
    text,
    done: false,
  });
  newTodo.value = "";
}

function toggleTodo(todo) {
  todo.done = !todo.done;
}

function removeTodo(id) {
  todos.value = todos.value.filter((t) => t.id !== id);
}
</script>

<template>
  <main class="todo-app">
    <h1>Todo List</h1>
    <p class="subtitle">{{ remaining }} task(s) remaining</p>

    <form class="todo-form" @submit.prevent="addTodo">
      <input
        v-model="newTodo"
        type="text"
        placeholder="What needs doing?"
        aria-label="New todo"
      />
      <button type="submit">Add</button>
    </form>

    <ul class="todo-list">
      <li
        v-for="todo in todos"
        :key="todo.id"
        :class="{ done: todo.done }"
      >
        <label>
          <input
            type="checkbox"
            :checked="todo.done"
            @change="toggleTodo(todo)"
          />
          <span>{{ todo.text }}</span>
        </label>
        <button type="button" class="remove" @click="removeTodo(todo.id)">
          Remove
        </button>
      </li>
    </ul>

    <p v-if="todos.length === 0" class="empty">No todos yet — add one above.</p>
  </main>
</template>

<style scoped>
.todo-app {
  max-width: 520px;
  margin: 2rem auto;
  padding: 1.5rem;
  font-family: system-ui, sans-serif;
}

h1 {
  margin: 0 0 0.25rem;
  font-size: 1.75rem;
}

.subtitle {
  margin: 0 0 1.25rem;
  color: #64748b;
  font-size: 0.9rem;
}

.todo-form {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.todo-form input {
  flex: 1;
  padding: 0.6rem 0.75rem;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 1rem;
}

.todo-form button {
  padding: 0.6rem 1rem;
  border: none;
  border-radius: 8px;
  background: #42b883;
  color: white;
  font-weight: 600;
  cursor: pointer;
}

.todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.todo-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0;
  border-bottom: 1px solid #e2e8f0;
}

.todo-list label {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 1;
  cursor: pointer;
}

.todo-list li.done span {
  text-decoration: line-through;
  color: #94a3b8;
}

.remove {
  border: none;
  background: transparent;
  color: #ef4444;
  cursor: pointer;
  font-size: 0.85rem;
}

.empty {
  color: #64748b;
  font-style: italic;
}
</style>
