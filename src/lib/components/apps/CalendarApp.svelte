<script lang="ts">
  import { loadJson, saveJson } from '$lib/persist';

  interface Props {
    windowId?: string;
  }

  let { windowId }: Props = $props();

  type EventsMap = Record<string, string[]>;

  let viewDate = $state(new Date());
  let selectedKey = $state(dateKey(new Date()));
  let events = $state<EventsMap>(loadJson('calendar', {}));
  let eventInput = $state('');

  function dateKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function persist() {
    saveJson('calendar', events);
  }

  const monthLabel = $derived(
    viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  );

  const todayKey = $derived(dateKey(new Date()));

  const calendarDays = $derived.by(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ key: string; day: number } | null> = [];

    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        key: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        day: d
      });
    }
    return cells;
  });

  const selectedLabel = $derived(
    new Date(`${selectedKey}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
  );

  const dayEvents = $derived(events[selectedKey] ?? []);

  function addEvent() {
    const text = eventInput.trim();
    if (!text) return;
    const list = [...(events[selectedKey] ?? []), text];
    events = { ...events, [selectedKey]: list };
    eventInput = '';
    persist();
  }

  function removeEvent(index: number) {
    const list = [...(events[selectedKey] ?? [])];
    list.splice(index, 1);
    const next = { ...events };
    if (list.length) next[selectedKey] = list;
    else delete next[selectedKey];
    events = next;
    persist();
  }
</script>

<div class="calendar-app">
  <div class="calendar-header">
    <button onclick={() => (viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}>‹</button>
    <span class="calendar-month-label">{monthLabel}</span>
    <button onclick={() => (viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}>›</button>
    <button
      class="calendar-today-btn"
      onclick={() => {
        viewDate = new Date();
        selectedKey = dateKey(new Date());
      }}
    >Today</button>
  </div>

  <div class="calendar-weekdays">
    <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span>
    <span>Thu</span><span>Fri</span><span>Sat</span>
  </div>

  <div class="calendar-grid">
    {#each calendarDays as cell}
      {#if cell}
        <button
          class="calendar-day"
          class:today={cell.key === todayKey}
          class:selected={cell.key === selectedKey}
          class:has-events={!!events[cell.key]?.length}
          onclick={() => (selectedKey = cell.key)}
        >{cell.day}</button>
      {:else}
        <div></div>
      {/if}
    {/each}
  </div>

  <div class="calendar-events">
    <h4>{selectedLabel}</h4>
    <ul class="calendar-event-list">
      {#if dayEvents.length === 0}
        <li class="calendar-no-events">No events</li>
      {:else}
        {#each dayEvents as ev, i}
          <li class="calendar-event-item">
            <span>{ev}</span>
            <button onclick={() => removeEvent(i)}>✕</button>
          </li>
        {/each}
      {/if}
    </ul>
    <div class="calendar-add-event">
      <input
        class="calendar-event-input"
        placeholder="Add event..."
        bind:value={eventInput}
        onkeydown={(e) => e.key === 'Enter' && addEvent()}
      />
      <button onclick={addEvent}>Add</button>
    </div>
  </div>
</div>
