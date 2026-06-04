import { setFrameSize, state } from '../store';

type Mode = 'r' | 'b' | 'rb';

// Drag handles on the right / bottom / corner of the frame to resize it (top-left anchored),
// which re-fires the page's media queries inside the iframe. Positioned in viewport space.
export default function ResizeHandles() {
  const startDrag = (e: PointerEvent, mode: Mode): void => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = state.frameWidth;
    const startH = state.frameHeight;

    const move = (ev: PointerEvent): void => {
      const dw = (ev.clientX - startX) / state.zoom;
      const dh = (ev.clientY - startY) / state.zoom;
      setFrameSize(mode === 'b' ? startW : startW + dw, mode === 'r' ? startH : startH + dh);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  };

  const right = state.panX + state.frameWidth * state.zoom;
  const bottom = state.panY + state.frameHeight * state.zoom;
  const midX = state.panX + (state.frameWidth * state.zoom) / 2;
  const midY = state.panY + (state.frameHeight * state.zoom) / 2;

  return (
    <div class="pointer-events-none absolute inset-0">
      <div
        class="pointer-events-auto absolute h-7 w-1.5 -translate-x-1/2 cursor-ew-resize rounded-full bg-sky-500/80 hover:bg-sky-400"
        style={{ left: `${right}px`, top: `${midY - 14}px` }}
        onPointerdown={(e) => startDrag(e, 'r')}
      />
      <div
        class="pointer-events-auto absolute h-1.5 w-7 -translate-y-1/2 cursor-ns-resize rounded-full bg-sky-500/80 hover:bg-sky-400"
        style={{ left: `${midX - 14}px`, top: `${bottom}px` }}
        onPointerdown={(e) => startDrag(e, 'b')}
      />
      <div
        class="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-sm border border-white/40 bg-sky-500 hover:bg-sky-400"
        style={{ left: `${right}px`, top: `${bottom}px` }}
        onPointerdown={(e) => startDrag(e, 'rb')}
      />
    </div>
  );
}
