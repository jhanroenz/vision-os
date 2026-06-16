<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { loadJson, saveJson } from '$lib/persist';

  interface Props {
    windowId?: string;
  }

  let { windowId }: Props = $props();

  const GRID = 20;
  const COLS = 19;
  const ROWS = 19;

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let score = $state(0);
  let highScore = $state(loadJson<number>('snake_high', 0));
  let running = $state(false);

  type Point = { x: number; y: number };
  let snake: Point[] = [];
  let direction: Point = { x: 1, y: 0 };
  let nextDirection: Point = { x: 1, y: 0 };
  let food: Point = { x: 0, y: 0 };
  let gameLoop: ReturnType<typeof setInterval> | null = null;

  function placeFood() {
    do {
      food = {
        x: Math.floor(Math.random() * COLS),
        y: Math.floor(Math.random() * ROWS)
      };
    } while (snake.some((s) => s.x === food.x && s.y === food.y));
  }

  function draw() {
    const ctx = canvasEl?.getContext('2d');
    if (!ctx || !canvasEl) return;
    ctx.fillStyle = '#12151f';
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

    ctx.fillStyle = '#3ecf8e';
    snake.forEach((seg, i) => {
      ctx.globalAlpha = i === 0 ? 1 : 0.7;
      ctx.fillRect(seg.x * GRID + 1, seg.y * GRID + 1, GRID - 2, GRID - 2);
    });
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#e74c6f';
    ctx.beginPath();
    ctx.arc(food.x * GRID + GRID / 2, food.y * GRID + GRID / 2, GRID / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function gameOver() {
    running = false;
    if (gameLoop) clearInterval(gameLoop);
    const ctx = canvasEl?.getContext('2d');
    if (!ctx || !canvasEl) return;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Game Over!', canvasEl.width / 2, canvasEl.height / 2 - 10);
    ctx.font = '14px system-ui';
    ctx.fillStyle = '#8b95a8';
    ctx.fillText('Press Restart or R', canvasEl.width / 2, canvasEl.height / 2 + 20);
  }

  function update() {
    if (!running) return;
    direction = { ...nextDirection };
    const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      gameOver();
      return;
    }
    if (snake.some((s) => s.x === head.x && s.y === head.y)) {
      gameOver();
      return;
    }

    snake = [head, ...snake];
    if (head.x === food.x && head.y === food.y) {
      score++;
      if (score > highScore) {
        highScore = score;
        saveJson('snake_high', highScore);
      }
      placeFood();
    } else {
      snake = snake.slice(0, -1);
    }
    draw();
  }

  function restart() {
    if (gameLoop) clearInterval(gameLoop);
    snake = [{ x: 10, y: 10 }];
    direction = { x: 1, y: 0 };
    nextDirection = { x: 1, y: 0 };
    score = 0;
    placeFood();
    running = true;
    draw();
    gameLoop = setInterval(update, 120);
  }

  function onKeydown(e: KeyboardEvent) {
    const map: Record<string, Point> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 },
      s: { x: 0, y: 1 },
      a: { x: -1, y: 0 },
      d: { x: 1, y: 0 }
    };
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const dir = map[key];
    if (dir && !(dir.x === -direction.x && dir.y === -direction.y)) {
      e.preventDefault();
      nextDirection = dir;
    }
    if (key === 'r' && !running) restart();
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown);
    restart();
    return () => window.removeEventListener('keydown', onKeydown);
  });

  onDestroy(() => {
    if (gameLoop) clearInterval(gameLoop);
  });
</script>

<div class="snake-app">
  <div class="snake-header">
    <span>Score: <strong>{score}</strong></span>
    <span>High: <strong>{highScore}</strong></span>
    <button onclick={restart}>Restart</button>
  </div>
  <canvas bind:this={canvasEl} class="snake-canvas" width="380" height="380"></canvas>
  <p class="snake-hint">Arrow keys or WASD to move</p>
</div>
