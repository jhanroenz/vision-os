import type { CanvasRenderer } from './catalog';

type RendererState = Record<string, unknown>;

type StateFactory = (w: number, h: number) => RendererState;
type Renderer = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: RendererState,
  delta: number,
  time: number
) => void;

const stateFactories: Record<CanvasRenderer, StateFactory> = {
  starfield(w, h) {
    const stars = [];
    for (let i = 0; i < 220; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.random() * 2 + 0.5,
        size: Math.random() * 1.8 + 0.3,
        twinkle: Math.random() * Math.PI * 2
      });
    }
    return { stars, w, h };
  },

  particles(w, h) {
    const particles = [];
    for (let i = 0; i < 55; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        radius: Math.random() * 2 + 1
      });
    }
    return { particles, w, h };
  },

  matrix(w, h) {
    const cols = Math.floor(w / 18);
    const drops = Array(cols)
      .fill(0)
      .map(() => Math.random() * -50);
    const chars = 'アイウエオカキクケコｱｲｳｴｵ01アイウエオ';
    return { drops, cols, chars, w, h };
  },

  neonGrid(w, h) {
    return { offset: 0, w, h };
  },

  bubbles(w, h) {
    const bubbles = [];
    for (let i = 0; i < 28; i++) {
      bubbles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 40 + 15,
        speed: Math.random() * 0.4 + 0.15,
        hue: Math.random() * 60 + 200
      });
    }
    return { bubbles, w, h };
  },

  fireflies(w, h) {
    const flies = [];
    for (let i = 0; i < 45; i++) {
      flies.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        phase: Math.random() * Math.PI * 2,
        size: Math.random() * 3 + 1
      });
    }
    return { flies, w, h };
  }
};

const renderers: Record<CanvasRenderer, Renderer> = {
  starfield(ctx, canvas, state, delta) {
    const stars = state.stars as Array<{
      x: number;
      y: number;
      z: number;
      size: number;
      twinkle: number;
    }>;

    ctx.fillStyle = 'rgba(5, 8, 16, 0.25)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    stars.forEach((s) => {
      s.twinkle += delta * 0.003;
      const alpha = 0.4 + Math.sin(s.twinkle) * 0.35;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * s.z, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200, 220, 255, ${alpha})`;
      ctx.fill();
      s.y += 0.02 * s.z * (delta / 16);
      if (s.y > canvas.height) {
        s.y = 0;
        s.x = Math.random() * canvas.width;
      }
    });
  },

  particles(ctx, canvas, state, delta) {
    const particles = state.particles as Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
    }>;

    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#0a0e1a');
    grad.addColorStop(1, '#141c2e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = delta / 16;
    particles.forEach((p) => {
      p.x += p.vx * scale;
      p.y += p.vy * scale;
      if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
    });

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(91, 141, 239, ${0.15 * (1 - dist / 120)})`;
          ctx.stroke();
        }
      }
    }

    particles.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(91, 141, 239, 0.7)';
      ctx.fill();
    });
  },

  matrix(ctx, canvas, state, delta) {
    const drops = state.drops as number[];
    const cols = state.cols as number;
    const chars = state.chars as string;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '14px monospace';
    const scale = delta / 16;

    for (let i = 0; i < cols; i++) {
      const char = chars[Math.floor(Math.random() * chars.length)];
      const x = i * 18;
      const y = drops[i] * 18;
      const brightness = Math.random() > 0.98 ? 1 : 0.6;
      ctx.fillStyle = `rgba(0, ${Math.floor(180 * brightness)}, 70, ${brightness})`;
      ctx.fillText(char, x, y);
      if (y > canvas.height && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i] += scale * (0.3 + Math.random() * 0.4);
    }
  },

  neonGrid(ctx, canvas, state, delta) {
    const w = canvas.width;
    const h = canvas.height;
    const offset = state.offset as number;

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0a0014');
    grad.addColorStop(0.6, '#12001f');
    grad.addColorStop(1, '#1a0030');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const horizon = h * 0.55;
    const sunGrad = ctx.createRadialGradient(w / 2, horizon, 10, w / 2, horizon, 120);
    sunGrad.addColorStop(0, '#ff2a6d');
    sunGrad.addColorStop(0.5, 'rgba(255, 42, 109, 0.3)');
    sunGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(0, 0, w, h);

    state.offset = (offset + delta * 0.08) % 40;
    ctx.strokeStyle = 'rgba(255, 42, 109, 0.5)';
    ctx.lineWidth = 1;

    for (let i = -40; i < w + 40; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i - (state.offset as number), horizon);
      ctx.lineTo(w / 2 + (i - w / 2) * 3 - (state.offset as number) * 2, h);
      ctx.stroke();
    }

    for (let j = 0; j < 12; j++) {
      const y = horizon + j * ((h - horizon) / 12);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.strokeStyle = `rgba(123, 47, 247, ${0.2 + j * 0.04})`;
      ctx.stroke();
    }
  },

  bubbles(ctx, canvas, state, delta) {
    const bubbles = state.bubbles as Array<{
      x: number;
      y: number;
      r: number;
      speed: number;
      hue: number;
    }>;

    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, '#0c1445');
    grad.addColorStop(1, '#1a3a6b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = delta / 16;
    bubbles.forEach((b) => {
      b.y -= b.speed * scale;
      b.x += Math.sin(b.y * 0.02) * 0.3;
      if (b.y + b.r < 0) {
        b.y = canvas.height + b.r;
        b.x = Math.random() * canvas.width;
      }
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${b.hue}, 70%, 60%, 0.12)`;
      ctx.fill();
      ctx.strokeStyle = `hsla(${b.hue}, 80%, 75%, 0.25)`;
      ctx.stroke();
    });
  },

  fireflies(ctx, canvas, state, delta) {
    const flies = state.flies as Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      phase: number;
      size: number;
    }>;

    ctx.fillStyle = 'rgba(5, 10, 5, 0.15)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = delta / 16;
    flies.forEach((f) => {
      f.x += f.vx * scale;
      f.y += f.vy * scale;
      f.phase += delta * 0.004;
      if (f.x < 0 || f.x > canvas.width) f.vx *= -1;
      if (f.y < 0 || f.y > canvas.height) f.vy *= -1;

      const glow = 0.3 + Math.sin(f.phase) * 0.5;
      const r = f.size * (1 + glow);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r * 4);
      g.addColorStop(0, `rgba(180, 255, 100, ${glow})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(f.x - r * 4, f.y - r * 4, r * 8, r * 8);
    });
  }
};

export function createCanvasLoop(
  canvas: HTMLCanvasElement,
  renderer: CanvasRenderer,
  speed: number,
  reducedMotion: boolean
): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const resize = () => {
    const parent = canvas.parentElement;
    if (!parent) return;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    state = stateFactories[renderer](canvas.width, canvas.height);
  };

  let state = stateFactories[renderer](canvas.width, canvas.height);
  let raf = 0;
  let lastTime = 0;
  const animSpeed = reducedMotion ? 0.35 : speed;

  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas.parentElement!);

  const tick = (time: number) => {
    const delta = lastTime ? (time - lastTime) * animSpeed : 16;
    lastTime = time;
    renderers[renderer](ctx, canvas, state, delta, time * animSpeed);
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
}
