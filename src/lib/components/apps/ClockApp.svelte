<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  interface Props {
    windowId?: string;
  }

  let { windowId }: Props = $props();

  let tab = $state<'clock' | 'stopwatch' | 'timer'>('clock');
  let clockTime = $state('');
  let clockDate = $state('');

  let swRunning = $state(false);
  let swElapsed = $state(0);
  let swStart = 0;
  let swDisplay = $state('00:00.00');
  let laps = $state<string[]>([]);
  let lapCount = 0;
  let swInterval: ReturnType<typeof setInterval> | null = null;

  let timerMin = $state(5);
  let timerSec = $state(0);
  let timerRemaining = $state(300);
  let timerDisplay = $state('05:00');
  let timerRunning = $state(false);
  let timerDone = $state(false);
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let timerStarted = false;

  let clockInterval: ReturnType<typeof setInterval>;

  function formatStopwatch(ms: number) {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  function formatTimer(secs: number) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function tickClock() {
    const now = new Date();
    clockTime = now.toLocaleTimeString();
    clockDate = now.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  function toggleStopwatch() {
    if (swRunning) {
      swRunning = false;
      if (swInterval) clearInterval(swInterval);
      swElapsed += Date.now() - swStart;
    } else {
      swRunning = true;
      swStart = Date.now();
      swInterval = setInterval(() => {
        swDisplay = formatStopwatch(swElapsed + Date.now() - swStart);
      }, 50);
    }
  }

  function lapStopwatch() {
    if (!swRunning) return;
    lapCount++;
    laps = [`Lap ${lapCount}: ${formatStopwatch(swElapsed + Date.now() - swStart)}`, ...laps];
  }

  function resetStopwatch() {
    swRunning = false;
    if (swInterval) clearInterval(swInterval);
    swElapsed = 0;
    lapCount = 0;
    swDisplay = '00:00.00';
    laps = [];
  }

  function toggleTimer() {
    if (timerRunning) {
      timerRunning = false;
      if (timerInterval) clearInterval(timerInterval);
    } else {
      if (!timerStarted) {
        timerRemaining = timerMin * 60 + timerSec;
        if (timerRemaining <= 0) return;
        timerDisplay = formatTimer(timerRemaining);
      }
      timerRunning = true;
      timerStarted = true;
      timerInterval = setInterval(() => {
        timerRemaining--;
        timerDisplay = formatTimer(timerRemaining);
        if (timerRemaining <= 0) {
          timerRunning = false;
          if (timerInterval) clearInterval(timerInterval);
          timerInterval = null;
          timerStarted = false;
          timerDisplay = 'Done!';
          timerDone = true;
          setTimeout(() => {
            timerDone = false;
          }, 3000);
        }
      }, 1000);
    }
  }

  function resetTimer() {
    timerRunning = false;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    timerStarted = false;
    timerRemaining = timerMin * 60 + timerSec;
    timerDisplay = formatTimer(timerRemaining);
    timerDone = false;
  }

  onMount(() => {
    tickClock();
    clockInterval = setInterval(tickClock, 1000);
  });

  onDestroy(() => {
    clearInterval(clockInterval);
    if (swInterval) clearInterval(swInterval);
    if (timerInterval) clearInterval(timerInterval);
  });
</script>

<div class="clock-app">
  <div class="clock-tabs">
    <button class="clock-tab" class:active={tab === 'clock'} onclick={() => (tab = 'clock')}>Clock</button>
    <button class="clock-tab" class:active={tab === 'stopwatch'} onclick={() => (tab = 'stopwatch')}>Stopwatch</button>
    <button class="clock-tab" class:active={tab === 'timer'} onclick={() => (tab = 'timer')}>Timer</button>
  </div>

  {#if tab === 'clock'}
    <div class="clock-panel active">
      <div class="clock-time-display">{clockTime}</div>
      <div class="clock-date-display">{clockDate}</div>
    </div>
  {:else if tab === 'stopwatch'}
    <div class="clock-panel active">
      <div class="clock-time-display">{swDisplay}</div>
      <div class="clock-controls">
        <button onclick={toggleStopwatch}>{swRunning ? 'Pause' : 'Start'}</button>
        <button onclick={lapStopwatch}>Lap</button>
        <button onclick={resetStopwatch}>Reset</button>
      </div>
      <div class="clock-laps">
        {#each laps as lap}
          <div class="clock-lap">{lap}</div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="clock-panel active">
      <div class="timer-inputs">
        <input type="number" min="0" max="99" bind:value={timerMin} />
        <span>:</span>
        <input type="number" min="0" max="59" bind:value={timerSec} />
      </div>
      <div class="clock-time-display timer-display" class:timer-done={timerDone}>{timerDisplay}</div>
      <div class="clock-controls">
        <button onclick={toggleTimer}>{timerRunning ? 'Pause' : 'Start'}</button>
        <button onclick={resetTimer}>Reset</button>
      </div>
    </div>
  {/if}
</div>
