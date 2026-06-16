<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    windowId?: string;
  }

  let { windowId }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let color = $state('#000000');
  let size = $state(3);
  let tool = $state<'brush' | 'eraser'>('brush');

  let drawing = false;
  let lastX = 0;
  let lastY = 0;

  function getPos(e: MouseEvent) {
    const canvas = canvasEl!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  function draw(x: number, y: number) {
    const ctx = canvasEl?.getContext('2d');
    if (!ctx) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size;
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastX = x;
    lastY = y;
  }

  function clearCanvas() {
    const ctx = canvasEl?.getContext('2d');
    if (!ctx || !canvasEl) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
  }

  function savePng() {
    if (!canvasEl) return;
    const link = document.createElement('a');
    link.download = 'visionos-painting.png';
    link.href = canvasEl.toDataURL('image/png');
    link.click();
  }

  onMount(() => {
    clearCanvas();
  });
</script>

<div class="paint-app">
  <div class="paint-toolbar">
    <span class="paint-label">Color</span>
    <input type="color" bind:value={color} aria-label="Color" />
    <span class="paint-label">Size</span>
    <input type="range" min="1" max="40" bind:value={size} aria-label="Brush size" />
    <button class="paint-tool" class:active={tool === 'brush'} onclick={() => (tool = 'brush')}>🖌 Brush</button>
    <button class="paint-tool" class:active={tool === 'eraser'} onclick={() => (tool = 'eraser')}>🧹 Eraser</button>
    <button onclick={clearCanvas}>Clear</button>
    <button onclick={savePng}>Save PNG</button>
  </div>
  <div class="paint-canvas-wrap">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <canvas
      bind:this={canvasEl}
      class="paint-canvas"
      width="640"
      height="400"
      onmousedown={(e) => {
        drawing = true;
        const pos = getPos(e);
        lastX = pos.x;
        lastY = pos.y;
        draw(pos.x, pos.y);
      }}
      onmousemove={(e) => {
        if (!drawing) return;
        const pos = getPos(e);
        draw(pos.x, pos.y);
      }}
      onmouseup={() => (drawing = false)}
      onmouseleave={() => (drawing = false)}
    ></canvas>
  </div>
</div>
