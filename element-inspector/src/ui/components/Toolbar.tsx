import { clearGuides, recenter, requestExit, resetSize, rotateFrame, setFrameSize, setZoom, state } from '../store';
import DevicePresets from './DevicePresets';

// Top bar: identity, responsive controls (presets + W×H inputs + rotate), and view controls
// (zoom, rulers, guides, reset, close).
export default function Toolbar() {
  const onWidth = (value: string): void => {
    const v = Number(value);
    if (v > 0) setFrameSize(v, state.frameHeight);
  };
  const onHeight = (value: string): void => {
    const v = Number(value);
    if (v > 0) setFrameSize(state.frameWidth, v);
  };

  return (
    <header class="flex h-11 shrink-0 items-center gap-3 border-b border-white/10 bg-[#11151f] px-3">
      <div class="flex items-center gap-2">
        <span class="text-[13px] font-semibold text-slate-100">Element Inspector</span>
        <span class="rounded bg-sky-600/20 px-1.5 py-0.5 font-mono text-[11px] text-sky-300">{state.tag}</span>
      </div>

      <div class="mx-1 h-5 w-px bg-white/10" />

      <DevicePresets />

      <div class="flex items-center gap-1 font-mono text-[11px] text-slate-300">
        <input
          type="number"
          value={state.frameWidth}
          onInput={(e) => onWidth(e.currentTarget.value)}
          class="w-16 rounded bg-white/5 px-1.5 py-1 text-center outline-none focus:bg-white/10"
        />
        <span class="text-slate-500">×</span>
        <input
          type="number"
          value={state.frameHeight}
          onInput={(e) => onHeight(e.currentTarget.value)}
          class="w-16 rounded bg-white/5 px-1.5 py-1 text-center outline-none focus:bg-white/10"
        />
      </div>
      <ToolButton label="Rotate" onClick={() => { rotateFrame(); recenter(); }} />

      <div class="ml-auto flex items-center gap-1">
        <ToolButton label="−" onClick={() => setZoom(state.zoom - 0.1)} />
        <span class="w-12 text-center font-mono text-[11px] text-slate-300">{Math.round(state.zoom * 100)}%</span>
        <ToolButton label="+" onClick={() => setZoom(state.zoom + 0.1)} />
        <ToolButton
          label="Fit"
          onClick={() => {
            resetSize();
            recenter();
          }}
        />

        <div class="mx-1 h-5 w-px bg-white/10" />

        <ToolButton label="Rulers" active={state.showRulers} onClick={() => (state.showRulers = !state.showRulers)} />
        <ToolButton label="Clear guides" onClick={clearGuides} />

        <div class="mx-1 h-5 w-px bg-white/10" />

        <button
          type="button"
          onClick={requestExit}
          class="rounded bg-white/5 px-2.5 py-1 text-[12px] text-slate-200 hover:bg-rose-600/80 hover:text-white"
        >
          Close (Esc)
        </button>
      </div>
    </header>
  );
}

function ToolButton(props: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={[
        'rounded px-2 py-1 text-[12px] transition-colors',
        props.active ? 'bg-sky-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10',
      ]}
    >
      {props.label}
    </button>
  );
}
