import { initHoloConstellations } from './holo-constellations';
import { initLogo3dCanvas } from './logo3d-canvas';

export type BootProgressPayload = {
  progress?: number;
  status?: string;
  detail?: string;
};

declare global {
  interface Window {
    visionOSBoot?: {
      update: (payload: BootProgressPayload) => void;
      complete: () => void;
    };
  }
}

function bootMarkup(): string {
  return `
  <div class="boot" id="boot">
    <div class="boot-glow"></div>
    <canvas class="jarvis-holo-constellations" id="holo" aria-hidden="true"></canvas>
    <div class="boot-content">
      <div class="boot-logo">
        <div class="boot-logo-mark">
          <div class="visionos-logo-3d-wrap" style="width:139px;height:139px">
            <canvas class="visionos-logo-3d" id="logo3d" role="img" aria-label="VisionOS"></canvas>
          </div>
        </div>
        <h1>
          <span class="boot-logo-word">Vision</span>
          <span class="boot-logo-sep" aria-hidden="true"></span>
          <span class="boot-logo-word">OS</span>
        </h1>
        <p>Jarvis Desktop Interface</p>
      </div>
      <div class="boot-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="progressbar">
        <div class="boot-progress-bar" id="progress"></div>
      </div>
      <p class="boot-status" id="status">Starting VisionOS…</p>
      <p class="boot-detail" id="detail">&nbsp;</p>
    </div>
  </div>`;
}

export function mountStartupBoot(root: ParentNode = document.body): void {
  root.innerHTML = bootMarkup();

  const holo = document.getElementById('holo');
  const logo3d = document.getElementById('logo3d');
  const progress = document.getElementById('progress') as HTMLDivElement | null;
  const progressbar = document.getElementById('progressbar');
  const status = document.getElementById('status');
  const detail = document.getElementById('detail');
  const boot = document.getElementById('boot');

  if (holo instanceof HTMLCanvasElement) {
    initHoloConstellations(holo);
  }
  if (logo3d instanceof HTMLCanvasElement) {
    initLogo3dCanvas(logo3d, { size: 88, speed: 1 });
  }

  window.visionOSBoot = {
    update(payload) {
      const p = Math.max(0, Math.min(100, Number(payload?.progress ?? 0)));
      if (progress) progress.style.width = `${p}%`;
      progressbar?.setAttribute('aria-valuenow', String(Math.round(p)));
      if (payload?.status && status) status.textContent = payload.status;
      if (detail) {
        detail.textContent = payload?.detail || '\u00a0';
      }
    },
    complete() {
      boot?.classList.add('fade-out');
    }
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mountStartupBoot());
  } else {
    mountStartupBoot();
  }
}
