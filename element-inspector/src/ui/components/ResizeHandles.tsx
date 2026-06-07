import { computed, shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import { setFrameSize, state } from '../store';
import { usePointerDrag } from '../composables';

type Mode = 'r' | 'b' | 'rb';

// Drag handles on the right / bottom / corner of the frame to resize it (top-left anchored),
// which re-fires the page's media queries inside the iframe. Positioned in viewport space —
// every coordinate reads reactive store state so the handles track pan/zoom/size live.
export default function ResizeHandles() {
  const rightHandle = shallowRef<HTMLDivElement>();
  const bottomHandle = shallowRef<HTMLDivElement>();
  const cornerHandle = shallowRef<HTMLDivElement>();

  const right = computed(() => state.panX + state.frameWidth * state.zoom);
  const bottom = computed(() => state.panY + state.frameHeight * state.zoom);
  const midX = computed(() => state.panX + (state.frameWidth * state.zoom) / 2);
  const midY = computed(() => state.panY + (state.frameHeight * state.zoom) / 2);

  bindResize(rightHandle, 'r');
  bindResize(bottomHandle, 'b');
  bindResize(cornerHandle, 'rb');

  return (
    <div class="pointer-events-none absolute inset-0">
      <div
        ref={rightHandle}
        class="pointer-events-auto absolute h-7 w-1.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full bg-sky-500/80 hover:bg-sky-400"
        style={{ left: `${right.value}px`, top: `${midY.value}px` }}
      />
      <div
        ref={bottomHandle}
        class="pointer-events-auto absolute h-1.5 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize rounded-full bg-sky-500/80 hover:bg-sky-400"
        style={{ left: `${midX.value}px`, top: `${bottom.value}px` }}
      />
      <div
        ref={cornerHandle}
        class="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-sm border border-white/40 bg-sky-500 hover:bg-sky-400"
        style={{ left: `${right.value}px`, top: `${bottom.value}px` }}
      />
    </div>
  );
}

function bindResize(handle: ShallowRef<HTMLDivElement | undefined>, mode: Mode): void {
  let startW = 0;
  let startH = 0;
  usePointerDrag(handle, {
    onStart: (e) => {
      e.preventDefault();
      startW = state.frameWidth;
      startH = state.frameHeight;
    },
    onMove: ({ dx, dy }) => {
      const width = mode === 'b' ? startW : startW + dx / state.zoom;
      const height = mode === 'r' ? startH : startH + dy / state.zoom;
      setFrameSize(width, height);
    },
    pointerCapture: true,
  });
}
