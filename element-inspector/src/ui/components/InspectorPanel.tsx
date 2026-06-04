import { computed } from 'vue';
import { state } from '../store';
import ColorSwatch from './ColorSwatch';

// Right sidebar. Shows the hovered element's metrics (falling back to the selected one):
// dimensions, spacing/radius, typography and colors (resolved to CSS variables when possible).
export default function InspectorPanel() {
  const info = computed(() => state.hover ?? state.selected);

  return (
    <aside class="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/10 bg-[#0e131c] p-4">
      {info.value ? (
        <>
          <div>
            <div class="font-mono text-sm text-sky-300">
              {info.value.tag}
              {info.value.id ? <span class="text-slate-500">#{info.value.id}</span> : null}
            </div>
            {info.value.classes.length ? (
              <div class="mt-0.5 truncate font-mono text-[11px] text-slate-500">.{info.value.classes.join('.')}</div>
            ) : null}
          </div>

          <section>
            <Heading text="Size" />
            <Row label="Width" value={`${info.value.width}px`} />
            <Row label="Height" value={`${info.value.height}px`} />
          </section>

          <section>
            <Heading text="Spacing" />
            <Row label="Padding" value={info.value.padding} />
            <Row label="Margin" value={info.value.margin} />
            <Row label="Radius" value={info.value.radius} />
          </section>

          <section>
            <Heading text="Typography" />
            <Row label="Font" value={info.value.font.family || '—'} />
            <Row label="Size" value={info.value.font.size} />
            <Row label="Weight" value={info.value.font.weight} />
            <Row label="Line" value={info.value.font.lineHeight} />
          </section>

          {info.value.colors.length ? (
            <section>
              <Heading text="Colors" />
              {info.value.colors.map((swatch) => (
                <ColorSwatch key={swatch.label + swatch.hex} swatch={swatch} />
              ))}
            </section>
          ) : null}
        </>
      ) : (
        <p class="text-[12px] text-slate-500">Hover an element on the canvas to inspect it.</p>
      )}
    </aside>
  );
}

function Heading(props: { text: string }) {
  return <h3 class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{props.text}</h3>;
}

function Row(props: { label: string; value: string }) {
  return (
    <div class="flex items-baseline justify-between gap-2 py-0.5">
      <span class="text-[11px] text-slate-400">{props.label}</span>
      <span class="ml-2 truncate font-mono text-[11px] text-slate-200">{props.value}</span>
    </div>
  );
}
