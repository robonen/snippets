import { computed } from 'vue';
import { clamp } from '@robonen/stdlib';
import { fmtG } from '../domain/format';

const COLORS = {
  protein: 'var(--color-protein)',
  fat: 'var(--color-fat)',
  carbs: 'var(--color-carbs)',
} as const;

/** Полоса «съедено/цель» по одному макронутриенту, в граммах. */
export default function MacroBar(props: {
  label: string;
  value: number;
  target: number;
  color: keyof typeof COLORS;
}) {
  const percent = computed(() => (props.target > 0 ? clamp((props.value / props.target) * 100, 0, 100) : 0));

  return (
    <div class="flex-1">
      <div class="mb-1.5 flex items-center gap-1.5 text-[12px] text-ink-soft">
        <span class="size-1.5 shrink-0 rounded-full" style={{ background: COLORS[props.color] }} />
        {props.label}
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-white/8">
        <div
          class="bar-fill h-full rounded-full"
          style={{ width: `${percent.value}%`, background: COLORS[props.color] }}
        />
      </div>
      <div class="mt-1 text-[11px] whitespace-nowrap text-ink-faint tnum">
        {`${fmtG(props.value)} / ${fmtG(props.target)} г`}
      </div>
    </div>
  );
}
