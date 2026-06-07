import { computed } from 'vue';
import { state } from '../store';

// Visualizes the selected element's grid/flex structure on the canvas: track lines with line
// numbers, shaded gaps and item outlines. Lives in viewport space and converts iframe-content
// pixels via the current pan/zoom (same mapping as the measurement layer). Hovering the Layout
// rows in the panel sets `state.layoutHighlight` to emphasize gaps / tracks / items.
export default function LayoutOverlay() {
  const sx = (x: number): number => state.panX + x * state.zoom;
  const sy = (y: number): number => state.panY + y * state.zoom;
  const sl = (len: number): number => len * state.zoom;
  const last = (a: number[] | undefined): number => (a && a.length ? a[a.length - 1]! : 0);

  // Flatten everything to plain, always-present arrays so the template maps without juggling
  // nullable getters (which neither Vapor's compiler nor TS narrowing handle gracefully).
  const decor = computed(() => {
    const layout = state.showGrid && state.selected?.layout.kind !== 'block' ? state.selected?.layout : null;
    const grid = layout?.kind === 'grid';
    return {
      gapTone: grid ? 'rgba(236,72,153,0.30)' : 'rgba(168,85,247,0.30)',
      gaps: layout?.gaps ?? [],
      items: layout?.items ?? [],
      vlines: (layout?.gridLines?.xs ?? []).map((x, i) => ({ x, n: i + 1 })),
      hlines: (layout?.gridLines?.ys ?? []).map((y, i) => ({ y, n: i + 1 })),
      x0: layout?.gridLines?.xs[0] ?? 0,
      x1: last(layout?.gridLines?.xs),
      y0: layout?.gridLines?.ys[0] ?? 0,
      y1: last(layout?.gridLines?.ys),
    };
  });

  return (
    <div class="pointer-events-none absolute inset-0 overflow-hidden">
      {decor.value.gaps.map((g, i) => (
        <div
          key={`gap${i}`}
          class="absolute"
          style={{
            left: `${sx(g.x)}px`,
            top: `${sy(g.y)}px`,
            width: `${sl(g.width)}px`,
            height: `${sl(g.height)}px`,
            background: decor.value.gapTone,
            outline: state.layoutHighlight === 'gap' ? '1px solid rgba(236,72,153,0.9)' : 'none',
            opacity: state.layoutHighlight === 'gap' ? 1 : 0.7,
          }}
        />
      ))}
      {decor.value.items.map((it, i) => (
        <div
          key={`item${i}`}
          class="absolute"
          style={{
            left: `${sx(it.x)}px`,
            top: `${sy(it.y)}px`,
            width: `${sl(it.width)}px`,
            height: `${sl(it.height)}px`,
            outline: `1px dashed rgba(56,189,248,${state.layoutHighlight === 'items' ? 0.95 : 0.5})`,
            outlineOffset: '-1px',
            background: state.layoutHighlight === 'items' ? 'rgba(56,189,248,0.10)' : 'transparent',
          }}
        />
      ))}
      {decor.value.vlines.map((l) => (
        <div
          key={`vx${l.n}`}
          class="absolute"
          style={{
            left: `${sx(l.x)}px`,
            top: `${sy(decor.value.y0)}px`,
            width: '1px',
            height: `${sl(decor.value.y1 - decor.value.y0)}px`,
            background: state.layoutHighlight === 'tracks' ? 'rgba(56,189,248,0.95)' : 'rgba(56,189,248,0.55)',
          }}
        >
          <span class="absolute -top-4 left-0 rounded-sm bg-sky-500 px-1 text-[9px] font-medium text-white">{l.n}</span>
        </div>
      ))}
      {decor.value.hlines.map((l) => (
        <div
          key={`hy${l.n}`}
          class="absolute"
          style={{
            left: `${sx(decor.value.x0)}px`,
            top: `${sy(l.y)}px`,
            width: `${sl(decor.value.x1 - decor.value.x0)}px`,
            height: '1px',
            background: state.layoutHighlight === 'tracks' ? 'rgba(56,189,248,0.95)' : 'rgba(56,189,248,0.55)',
          }}
        >
          <span class="absolute -left-4 top-0 -translate-y-1/2 rounded-sm bg-sky-500 px-1 text-[9px] font-medium text-white">
            {l.n}
          </span>
        </div>
      ))}
    </div>
  );
}
