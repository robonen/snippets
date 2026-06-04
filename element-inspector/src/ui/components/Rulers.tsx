import { onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import { addGuide, state } from '../store';

const SIZE = 20;
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

// Zoom/pan-aware rulers drawn on <canvas>. Clicking a ruler drops a guide at that position.
export default function Rulers() {
  const topCanvas = ref<HTMLCanvasElement>();
  const leftCanvas = ref<HTMLCanvasElement>();

  const draw = (): void => {
    if (topCanvas.value) drawAxis(topCanvas.value, 'x');
    if (leftCanvas.value) drawAxis(leftCanvas.value, 'y');
  };

  let stop: (() => void) | undefined;
  onMounted(() => {
    stop = watchEffect(draw);
    window.addEventListener('resize', draw);
  });
  onBeforeUnmount(() => {
    stop?.();
    window.removeEventListener('resize', draw);
  });

  const onTopClick = (e: MouseEvent): void => {
    const offset = e.clientX - (topCanvas.value?.getBoundingClientRect().left ?? 0);
    addGuide('x', (offset - state.panX) / state.zoom);
  };
  const onLeftClick = (e: MouseEvent): void => {
    const offset = e.clientY - (leftCanvas.value?.getBoundingClientRect().top ?? 0);
    addGuide('y', (offset - state.panY) / state.zoom);
  };

  return (
    <>
      <canvas
        ref={topCanvas}
        onClick={(e) => onTopClick(e.nativeEvent)}
        class="absolute left-0 top-0 cursor-crosshair"
        style={{ height: `${SIZE}px` }}
      />
      <canvas
        ref={leftCanvas}
        onClick={(e) => onLeftClick(e.nativeEvent)}
        class="absolute left-0 top-0 cursor-crosshair"
        style={{ width: `${SIZE}px` }}
      />
      <div class="absolute left-0 top-0 border-b border-r border-white/10 bg-[#11151f]" style={{ width: `${SIZE}px`, height: `${SIZE}px` }} />
    </>
  );
}

function niceStep(zoom: number, minPx: number): number {
  for (const step of STEPS) {
    if (step * zoom >= minPx) return step;
  }
  return STEPS[STEPS.length - 1]!;
}

function drawAxis(canvas: HTMLCanvasElement, axis: 'x' | 'y'): void {
  const parent = canvas.parentElement;
  if (!parent) return;
  const dpr = window.devicePixelRatio || 1;
  const length = axis === 'x' ? parent.clientWidth : parent.clientHeight;
  const cssW = axis === 'x' ? length : SIZE;
  const cssH = axis === 'x' ? SIZE : length;

  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#11151f';
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.strokeStyle = 'rgba(148,163,184,0.35)';
  ctx.fillStyle = 'rgba(148,163,184,0.85)';
  ctx.font = '9px ui-monospace, monospace';
  ctx.lineWidth = 1;

  const pan = axis === 'x' ? state.panX : state.panY;
  const major = niceStep(state.zoom, 56);
  const minor = major / (major % 5 === 0 ? 5 : 4);

  const firstValue = Math.floor((0 - pan) / state.zoom / minor) * minor;
  for (let v = firstValue; pan + v * state.zoom <= length; v += minor) {
    const pos = pan + v * state.zoom;
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
