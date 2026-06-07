import { shallowRef } from 'vue';
import { removeGuide, state, updateGuide } from '../store';

// The ruler band size (must match Rulers' SIZE). Dropping a guide back over its ruler removes it.
const RULER = 20;

// Interactive guides drawn over the canvas. Each guide is a thin draggable strip: drag to
// reposition, drag back onto its ruler (or double-click) to remove. New guides are pulled out
// of the rulers (see Rulers.tsx). Positions are stored in iframe-content pixels and mapped to
// the viewport via the current pan/zoom.
export default function GuidesLayer() {
  const layer = shallowRef<HTMLDivElement>();

  const startMove = (axis: 'x' | 'y', index: number): void => {
    const rect = layer.value?.getBoundingClientRect();
    if (!rect) return;
    const move = (ev: PointerEvent): void => {
      const pos =
        axis === 'x'
          ? (ev.clientX - rect.left - state.panX) / state.zoom
          : (ev.clientY - rect.top - state.panY) / state.zoom;
      updateGuide(axis, index, pos);
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      // Released over the originating ruler band → remove the guide.
      const overRuler = axis === 'x' ? ev.clientY - rect.top < RULER : ev.clientX - rect.left < RULER;
      if (overRuler) removeGuide(axis, index);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  };

  const begin = (e: { preventDefault(): void; stopPropagation(): void }, axis: 'x' | 'y', index: number): void => {
    e.preventDefault();
    e.stopPropagation();
    startMove(axis, index);
  };

  return (
    <div ref={layer} class="pointer-events-none absolute inset-0 overflow-hidden">
      {state.guides.x.map((gx, i) => (
        <div
          key={`x${i}`}
          class="pointer-events-auto absolute bottom-0 top-0 -ml-1 w-2 cursor-ew-resize"
          style={{ left: `${state.panX + gx * state.zoom}px` }}
          onPointerdown={(e) => begin(e, 'x', i)}
          onDblclick={() => removeGuide('x', i)}
        >
          <div class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-sky-400/80" />
          <span class="absolute left-1.5 top-1 rounded bg-sky-500 px-1 text-[10px] font-medium text-white">
            {Math.round(gx)}
          </span>
        </div>
      ))}
      {state.guides.y.map((gy, i) => (
        <div
          key={`y${i}`}
          class="pointer-events-auto absolute left-0 right-0 -mt-1 h-2 cursor-ns-resize"
          style={{ top: `${state.panY + gy * state.zoom}px` }}
          onPointerdown={(e) => begin(e, 'y', i)}
          onDblclick={() => removeGuide('y', i)}
        >
          <div class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-sky-400/80" />
          <span class="absolute left-1 top-1.5 rounded bg-sky-500 px-1 text-[10px] font-medium text-white">
            {Math.round(gy)}
          </span>
        </div>
      ))}
    </div>
  );
}
