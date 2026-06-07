import { computed } from 'vue';
import { state } from '../store';
import type { LayoutHighlight, StyleItem } from '../store';
import ColorSwatch from './ColorSwatch';

// Right sidebar. Shows the hovered element's metrics (falling back to the selected one):
// dimensions, layout (with hover-to-highlight on the canvas), spacing, typography, effects and
// colors — inherited values are flagged, and colors resolve to CSS variables when possible.
export default function InspectorPanel() {
  const info = computed(() => state.hover ?? state.selected);

  const highlightFor = (label: string): LayoutHighlight =>
    label === 'Gap' ? 'gap' : label === 'Columns' || label === 'Rows' ? 'tracks' : 'none';

  return (
    <aside class="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/10 bg-[#0e131c] p-4 [&::-webkit-scrollbar-thumb]:rounded-md [&::-webkit-scrollbar-thumb]:bg-slate-400/25 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar]:w-2.5">
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
            <Heading text="Layout" />
            <div class="flex items-baseline justify-between gap-2 py-0.5">
              <span class="text-[11px] text-slate-400">Display</span>
              <span
                class={[
                  'ml-2 truncate rounded px-1.5 font-mono text-[11px]',
                  info.value.layout.kind === 'flex'
                    ? 'bg-violet-500/20 text-violet-300'
                    : info.value.layout.kind === 'grid'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-white/5 text-slate-200',
                ]}
              >
                {info.value.layout.display}
              </span>
            </div>
            {info.value.layout.props.map((prop) => (
              <div
                key={prop.label}
                class="-mx-1 rounded px-1 hover:bg-white/5"
                onMouseenter={() => (state.layoutHighlight = highlightFor(prop.label))}
                onMouseleave={() => (state.layoutHighlight = 'none')}
              >
                <Row label={prop.label} value={prop.value} />
              </div>
            ))}
            {info.value.layout.items.length ? (
              <div
                class="-mx-1 rounded px-1 hover:bg-white/5"
                onMouseenter={() => (state.layoutHighlight = 'items')}
                onMouseleave={() => (state.layoutHighlight = 'none')}
              >
                <Row label="Items" value={String(info.value.layout.items.length)} />
              </div>
            ) : null}
          </section>

          <section>
            <Heading text="Spacing" />
            <Row label="Padding" value={info.value.padding} />
            <Row label="Margin" value={info.value.margin} />
            <Row label="Radius" value={info.value.radius} />
          </section>

          <section>
            <Heading text="Typography" />
            {info.value.typography.map((item) => (
              <StyleRow key={item.label} item={item} />
            ))}
          </section>

          {info.value.effects.length ? (
            <section>
              <Heading text="Effects" />
              {info.value.effects.map((item) => (
                <StyleRow key={item.label} item={item} />
              ))}
            </section>
          ) : null}

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

// A computed-style row that flags inherited values with an `inh` badge.
function StyleRow(props: { item: StyleItem }) {
  return (
    <div class="flex items-baseline justify-between gap-2 py-0.5">
      <span class="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
        {props.item.label}
        {props.item.inherited ? (
          <span title="Inherited from an ancestor" class="rounded-sm bg-amber-500/15 px-1 text-[9px] text-amber-300">
            inh
          </span>
        ) : null}
      </span>
      <span class="ml-2 truncate font-mono text-[11px] text-slate-200">{props.item.value}</span>
    </div>
  );
}
