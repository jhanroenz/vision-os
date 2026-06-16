<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    speed?: number;
  }

  let { speed = 1 }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let reducedMotion = $state(false);

  type Mote = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    phase: number;
  };

  onMount(() => {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  $effect(() => {
    const el = canvas;
    if (!el) return;

    const parent = el.parentElement;
    if (!parent) return;

    const motes: Mote[] = [];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const animSpeed = reducedMotion ? 0.35 : speed;
    let raf = 0;
    let w = 0;
    let h = 0;

    const seedMotes = () => {
      motes.length = 0;
      for (let i = 0; i < 48; i++) {
        motes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.12,
          vy: (Math.random() - 0.5) * 0.12,
          size: Math.random() * 1.4 + 0.4,
          phase: Math.random() * Math.PI * 2
        });
      }
    };

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      if (motes.length === 0) seedMotes();
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    let last = 0;

    const tick = (time: number) => {
      const delta = (last ? time - last : 16) * animSpeed;
      last = time;

      const ctx = el.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const scale = delta / 16;
      for (const m of motes) {
        m.x += m.vx * scale;
        m.y += m.vy * scale;
        m.phase += delta * 0.003;
        if (m.x < 0) m.x = w;
        if (m.x > w) m.x = 0;
        if (m.y < 0) m.y = h;
        if (m.y > h) m.y = 0;

        const twinkle = 0.25 + Math.sin(m.phase) * 0.35;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(120, 220, 255, ${twinkle})`;
        ctx.fill();
      }

      for (let i = 0; i < motes.length; i++) {
        for (let j = i + 1; j < motes.length; j++) {
          const a = motes[i];
          const b = motes[j];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist > 90) continue;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(74, 216, 255, ${0.06 * (1 - dist / 90)})`;
          ctx.stroke();
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  });
</script>

<canvas
  class="jarvis-holo-constellations"
  bind:this={canvas}
  aria-hidden="true"
></canvas>
