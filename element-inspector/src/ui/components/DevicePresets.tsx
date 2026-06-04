import { DEVICE_PRESETS, recenter, setDevice, state } from '../store';

// Quick responsive-width presets. Picking one resizes the frame and re-centers it.
export default function DevicePresets() {
  return (
    <div class="flex items-center gap-1">
      {DEVICE_PRESETS.map((preset) => {
        const active = state.frameWidth === preset.width && state.frameHeight === preset.height;
        return (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              setDevice(preset);
              recenter();
            }}
            class={[
              'rounded px-2 py-1 font-mono text-[11px] transition-colors',
              active ? 'bg-sky-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10',
            ]}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
