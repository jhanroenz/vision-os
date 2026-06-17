import {
  createSphereWireframe,
  projectVertex,
  rotateX,
  rotateY,
  rotateZ,
  type Vec3
} from '$lib/components/branding/sphereMesh3d';

export type Logo3dCanvasOptions = {
  size?: number;
  speed?: number;
  reducedMotion?: boolean;
};

export type Logo3dCanvasHandle = {
  destroy: () => void;
};

export function initLogo3dCanvas(
  canvas: HTMLCanvasElement,
  options: Logo3dCanvasOptions = {}
): Logo3dCanvasHandle {
  const size = options.size ?? 88;
  const canvasPad = 1.58;
  const canvasSize = Math.round(size * canvasPad);
  const reducedMotion =
    options.reducedMotion ??
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animSpeed = reducedMotion ? 0.35 : (options.speed ?? 1);

  const mesh = createSphereWireframe(9, 16);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let raf = 0;

  const resize = () => {
    canvas.width = Math.round(canvasSize * dpr);
    canvas.height = Math.round(canvasSize * dpr);
    canvas.style.width = `${canvasSize}px`;
    canvas.style.height = `${canvasSize}px`;
  };

  resize();

  const tick = (time: number) => {
    const t = time * animSpeed;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasSize, canvasSize);

    const cx = canvasSize / 2;
    const cy = canvasSize / 2;
    const radius = size * 0.51 * 1.03;

    const rotY = t * 0.00055;
    const rotX = 0.62 + Math.sin(t * 0.00025) * 0.12;
    const rotZ = Math.sin(t * 0.00014) * 0.08;

    const halo = ctx.createRadialGradient(cx, cy, radius * 0.05, cx, cy, radius * 1.35);
    halo.addColorStop(0, 'rgba(95, 228, 255, 0.23)');
    halo.addColorStop(0.5, 'rgba(46, 200, 255, 0.08)');
    halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.35, 0, Math.PI * 2);
    ctx.fill();

    const transformed = mesh.vertices.map((v) => {
      let p: Vec3 = v;
      p = rotateX(p, rotX);
      p = rotateY(p, rotY);
      p = rotateZ(p, rotZ);
      return projectVertex(p, cx, cy, radius);
    });

    const sortedEdges = [...mesh.edges].sort((a, b) => {
      const za = (transformed[a[0]].z + transformed[a[1]].z) * 0.5;
      const zb = (transformed[b[0]].z + transformed[b[1]].z) * 0.5;
      return za - zb;
    });

    ctx.lineCap = 'round';
    for (const [a, b] of sortedEdges) {
      const pa = transformed[a];
      const pb = transformed[b];
      const depth = (pa.z + pb.z) * 0.5;
      const alpha = 0.28 + (depth + 1) * 0.32;
      ctx.strokeStyle = `rgba(95, 228, 255, ${Math.min(0.92, alpha)})`;
      ctx.lineWidth = Math.max(0.55, 0.85 * ((pa.scale + pb.scale) * 0.5));
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    const sortedVerts = transformed
      .map((p, i) => ({ ...p, i }))
      .sort((a, b) => a.z - b.z);

    for (const p of sortedVerts) {
      const alpha = 0.45 + (p.z + 1) * 0.28;
      const nr = Math.max(0.75, 1.35 * p.scale);
      const ng = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, nr * 2);
      ng.addColorStop(0, `rgba(255, 255, 255, ${0.95 * alpha})`);
      ng.addColorStop(0.45, `rgba(142, 233, 255, ${0.65 * alpha})`);
      ng.addColorStop(1, 'transparent');
      ctx.fillStyle = ng;
      ctx.beginPath();
      ctx.arc(p.x, p.y, nr * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(230, 250, 255, ${0.92 * alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, nr, 0, Math.PI * 2);
      ctx.fill();
    }

    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);

  return {
    destroy: () => {
      cancelAnimationFrame(raf);
    }
  };
}
