import { shallowRef, watchEffect } from 'vue';
import { addGuide, state, updateGuide } from '../store';
import { useDevicePixelRatio, useEventListener } from '../composables';

const SIZE = 20;
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

// Zoom/pan-aware rulers drawn on <canvas>. Press a ruler and drag to pull out a guide (it
// follows the cursor); the guide can then be moved/removed via GuidesLayer. A plain click drops
// a guide at that point. Geometry is driven entirely by reactive store state (zoom/pan/viewport)
// so the rulers redraw whenever the canvas is panned, zoomed or resized.
export default function Rulers() {
  const topCanvas = shallowRef<HTMLCanvasElement>();
  const leftCanvas = shallowRef<HTMLCanvasElement>();
  const { pixelRatio } = useDevicePixelRatio();

  // `flush: 'post'` so template refs are populated before the first draw.
  watchEffect(
    () => {
      const dpr = pixelRatio.value;
      const { zoom, panX, panY, viewportW, viewportH } = state;
      if (topCanvas.value && viewportW > 0) drawAxis(topCanvas.value, 'x', viewportW, zoom, panX, dpr);
      if (leftCanvas.value && viewportH > 0) drawAxis(leftCanvas.value, 'y', viewportH, zoom, panY, dpr);
    },
    { flush: 'post' },
  );

  // Pull-out gesture: press a ruler to create a guide, then drag to position it. Bound natively
  // (not via JSX) so we get real DOM PointerEvents. The guide follows the cursor until release;
  // moving/removing an existing guide is handled by GuidesLayer.
  const startCreate = (axis: 'x' | 'y', e: PointerEvent): void => {
    e.preventDefault();
    const originEl = (axis === 'x' ? topCanvas.value : leftCanvas.value)?.getBoundingClientRect();
    if (!originEl) return;
    const toPos = (ev: PointerEvent): number =>
      axis === 'x'
        ? (ev.clientX - originEl.left - state.panX) / state.zoom
        : (ev.clientY - originEl.top - state.panY) / state.zoom;
    const index = addGuide(axis, toPos(e));
    const move = (ev: PointerEvent): void => updateGuide(axis, index, toPos(ev));
    const up = (): void => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  };

  useEventListener(topCanvas, 'pointerdown', (e: PointerEvent) => startCreate('x', e));
  useEventListener(leftCanvas, 'pointerdown', (e: PointerEvent) => startCreate('y', e));

  return (
    <>
      <canvas ref={topCanvas} class="absolute left-0 top-0 cursor-crosshair" style={{ height: `${SIZE}px` }} />
      <canvas ref={leftCanvas} class="absolute left-0 top-0 cursor-crosshair" style={{ width: `${SIZE}px` }} />
      <div
        class="absolute left-0 top-0 border-b border-r border-white/10 bg-[#11151f]"
        style={{ width: `${SIZE}px`, height: `${SIZE}px` }}
      />
    </>
  );
}

function niceStep(zoom: number, minPx: number): number {
  for (const step of STEPS) {
    if (step * zoom >= minPx) return step;
  }
  return STEPS[STEPS.length - 1]!;
}

function drawAxis(
  canvas: HTMLCanvasElement,
  axis: 'x' | 'y',
  length: number,
  zoom: number,
  pan: number,
  dpr: number,
): void {
  const cssW = axis === 'x' ? length : SIZE;
  const cssH = axis === 'x' ? SIZE : length;

  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#11151f';
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.strokeStyle = 'rgba(148,163,184,0.35)';
  ctx.fillStyle = 'rgba(148,163,184,0.85)';
  ctx.font = '9px ui-monospace, monospace';
  ctx.lineWidth = 1;

  const major = niceStep(zoom, 56);
  const minor = major / (major % 5 === 0 ? 5 : 4);

  const firstValue = Math.floor((0 - pan) / zoom / minor) * minor;
  for (let v = firstValue; pan + v * zoom <= length; v += minor) {
    const pos = pan + v * zoom;
    if (pos < 0) continue;
    const isMajor = Math.abs(v % major) < 0.001;
    const tick = isMajor ? SIZE * 0.6 : SIZE * 0.3;
    ctx.beginPath();
    if (axis === 'x') {
      ctx.moveTo(pos + 0.5, SIZE);
      ctx.lineTo(pos + 0.5, SIZE - tick);
    } else {
      ctx.moveTo(SIZE, pos + 0.5);
      ctx.lineTo(SIZE - tick, pos + 0.5);
    }
    ctx.stroke();

    if (isMajor) {
      const label = String(Math.round(v));
      if (axis === 'x') {
        ctx.fillText(label, pos + 2, 9);
      } else {
        ctx.save();
        ctx.translate(9, pos - 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
  }
}
