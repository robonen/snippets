import { state } from '../store';
import type { Box } from '../../utils/rect';

// Draws the box-model overlay for the hovered element, a persistent outline for the
// selected element, and any guides. Lives in viewport space (constant-size badges) and
// converts iframe-pixel coordinates to screen coordinates via the current pan/zoom.
export default function MeasureLayer() {
  const boxStyle = (b: Box) => ({
    position: 'absolute' as const,
    left: `${state.panX + b.x * state.zoom}px`,
    top: `${state.panY + b.y * state.zoom}px`,
    width: `${b.width * state.zoom}px`,
    height: `${b.height * state.zoom}px`,
  });

  return (
    <div class="pointer-events-none absolute inset-0 overflow-hidden">
      {state.hover ? (
        <>
          <div style={{ ...boxStyle(state.hover.box.margin), background: 'rgba(246,160,92,0.40)' }} />
          <div style={{ ...boxStyle(state.hover.box.border), background: 'rgba(247,205,128,0.45)' }} />
          <div style={{ ...boxStyle(state.hover.box.padding), background: 'rgba(125,206,160,0.40)' }} />
          <div style={{ ...boxStyle(state.hover.box.content), background: 'rgba(116,178,255,0.40)' }} />
          <Badge box={state.hover.box.border} text={`${state.hover.width} × ${state.hover.height}`} tone="sky" />
        </>
      ) : null}

      {state.selected ? (
        <div style={{ ...boxStyle(state.selected.box.border), outline: '2px solid #3b82f6', outlineOffset: '-1px' }} />
      ) : null}

      {state.guides.x.map((gx) => (
        <div
          key={`x${gx}`}
          class="absolute bottom-0 top-0 w-px bg-sky-400/80"
          style={{ left: `${state.panX + gx * state.zoom}px` }}
        >
          <span class="absolute left-1 top-1 rounded bg-sky-500 px-1 text-[10px] font-medium text-white">{gx}</span>
        </div>
      ))}
      {state.guides.y.map((gy) => (
        <div
          key={`y${gy}`}
          class="absolute left-0 right-0 h-px bg-sky-400/80"
          style={{ top: `${state.panY + gy * state.zoom}px` }}
        >
          <span class="absolute left-1 top-1 rounded bg-sky-500 px-1 text-[10px] font-medium text-white">{gy}</span>
        </div>
      ))}
    </div>
  );
}

function Badge(props: { box: Box; text: string; tone: 'sky' }) {
  const left = state.panX + props.box.x * state.zoom;
  const top = state.panY + props.box.y * state.zoom;
  return (
    <div
      class="absolute -translate-y-full rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow"
      style={{ left: `${Math.max(0, left)}px`, top: `${Math.max(14, top)}px` }}
    >
      {props.text}
    </div>
  );
}
