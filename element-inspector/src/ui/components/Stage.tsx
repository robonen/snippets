import { onBeforeUnmount, onMounted, ref } from 'vue';
import { recenter, state, zoomAt } from '../store';
import { useFrame } from '../composables/useFrame';
import MeasureLayer from './MeasureLayer';
import ResizeHandles from './ResizeHandles';
import Rulers from './Rulers';

// The canvas: a pannable/zoomable viewport holding the device frame (an iframe with the
// isolated element), plus the measurement overlay, resize handles and rulers.
export default function Stage() {
  const viewport = ref<HTMLDivElement>();
  const frame = ref<HTMLIFrameElement>();
  useFrame(frame);

  let observer: ResizeObserver | undefined;
  onMounted(() => {
    const el = viewport.value;
    if (!el) return;
    state.viewportW = el.clientWidth;
    state.viewportH = el.clientHeight;
    recenter();
    observer = new ResizeObserver(() => {
      state.viewportW = el.clientWidth;
      state.viewportH = el.clientHeight;
    });
    observer.observe(el);
  });
  onBeforeUnmount(() => observer?.disconnect());

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = viewport.value!.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - rect.left, e.clientY - rect.top);
  };

  let panning = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  const onPointerdown = (e: PointerEvent): void => {
    if (e.target !== viewport.value) return; // only pan on the empty background
    panning = true;
    startX = e.clientX;
    startY = e.clientY;
    originX = state.panX;
    originY = state.panY;
    viewport.value!.setPointerCapture(e.pointerId);
  };
  const onPointermove = (e: PointerEvent): void => {
    if (!panning) return;
    state.panX = originX + (e.clientX - startX);
    state.panY = originY + (e.clientY - startY);
  };
  const onPointerup = (e: PointerEvent): void => {
    panning = false;
    try {
      viewport.value!.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  return (
    <div
      ref={viewport}
      class="ei-grid relative min-w-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
      onWheel={(e) => onWheel(e.nativeEvent)}
      onPointerdown={onPointerdown}
      onPointermove={onPointermove}
      onPointerup={onPointerup}
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

      <MeasureLayer />
      <ResizeHandles />
      {state.showRulers ? <Rulers /> : null}
    </div>
  );
}
