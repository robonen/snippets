import type { ColorSwatch as Swatch } from '../store';
import { useClipboard } from '../composables';

// A single color row: swatch + label + value (CSS variable name when resolved, else hex).
// Clicking copies `var(--name)` or the hex to the clipboard.
export default function ColorSwatch(props: { swatch: Swatch }) {
  const { copy, copied } = useClipboard();
  const onCopy = (): void => {
    void copy(props.swatch.varName ? `var(${props.swatch.varName})` : props.swatch.hex);
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      title="Copy"
      class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-white/5"
    >
      <span class="h-6 w-6 shrink-0 rounded border border-white/15" style={{ background: props.swatch.hex }} />
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
          {props.swatch.label}
          {props.swatch.inherited ? (
            <span title="Inherited from an ancestor" class="rounded-sm bg-amber-500/15 px-1 text-[9px] normal-case text-amber-300">
              inh
            </span>
          ) : null}
        </span>
        <span class="block truncate font-mono text-[11px] text-slate-200">
          {props.swatch.varName ?? props.swatch.hex}
        </span>
      </span>
      <span class="shrink-0 font-mono text-[10px] text-slate-500">
        {copied.value ? 'copied' : props.swatch.varName ? props.swatch.hex : ''}
      </span>
    </button>
  );
}
