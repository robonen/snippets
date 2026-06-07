import { shallowRef, watch } from 'vue';
import { recenter, state, zoomAt } from '../store';
import { useElementSize, useEventListener, useFrame, usePointerDrag } from '../composables';
import LayoutOverlay from './LayoutOverlay';
import MeasureLayer from './MeasureLayer';
import GuidesLayer from './GuidesLayer';
import ResizeHandles from './ResizeHandles';
import Rulers from './Rulers';

// The canvas: a pannable/zoomable viewport holding the device frame (an iframe with the
// isolated element), plus the measurement overlay, resize handles and rulers.
export default function Stage() {
  const viewport = shallowRef<HTMLDivElement>();
  const frame = shallowRef<HTMLIFrameElement>();
  useFrame(frame);

  // Track the viewport size for centering + ruler geometry; center once it has a real size.
  const { width, height } = useElementSize(viewport);
  let centered = false;
  watch(
    [width, height],
    ([w, h]) => {
      state.viewportW = w;
      state.viewportH = h;
      if (!centered && w > 0 && h > 0) {
        centered = true;
        recenter();
      }
    },
    { immediate: true },
  );

  // Wheel = zoom about the cursor. Bound natively (not via JSX) so we can opt out of passive
  // and call preventDefault to stop the page scrolling underneath.
  useEventListener(
    viewport,
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      const rect = viewport.value!.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - rect.left, e.clientY - rect.top);
    },
    { passive: false },
  );

  // Drag the empty background to pan.
  let originX = 0;
  let originY = 0;
  usePointerDrag(viewport, {
    onStart: (e) => {
      if (e.target !== viewport.value) return false; // only pan on the empty background
      e.preventDefault();
      originX = state.panX;
      originY = state.panY;
    },
    onMove: ({ dx, dy }) => {
      state.panX = originX + dx;
      state.panY = originY + dy;
    },
    pointerCapture: true,
  });

  return (
    <div
      ref={viewport}
      class="relative min-w-0 flex-1 cursor-grab overflow-hidden bg-[#0b0e14] bg-[radial-gradient(circle,rgba(148,163,184,0.12)_1px,transparent_1px)] [background-size:16px_16px] active:cursor-grabbing"
    >
      <div
        class="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`,
          width: `${state.frameWidth}px`,
          height: `${state.frameHeight}px`,
        }}
      >
        <iframe
          ref={frame}
          title="Isolated element"
          sandbox="allow-same-origin"
          class="block h-full w-full border-0 bg-white"
          style={{ boxShadow: '0 0 0 1px rgba(148,163,184,0.45)' }}
        />
      </div>

      <LayoutOverlay />
      <MeasureLayer />
      <GuidesLayer />
      <ResizeHandles />
      {state.showRulers ? <Rulers /> : null}
    </div>
  );
}
