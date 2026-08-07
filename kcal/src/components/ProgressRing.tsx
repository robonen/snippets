import { computed } from 'vue';
import { clamp } from '@robonen/stdlib';
import { fmtKcal } from '../domain/format';

const SIZE = 216;
const RADIUS = 92;
const STROKE = 11;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Главный индикатор дня: съедено против цели, в центре — остаток.
 * При переборе дуга замыкается и меняет цвет, остаток становится «сверх цели».
 */
export default function ProgressRing(props: { eaten: number; target: number }) {
  const over = computed(() => props.eaten > props.target);
  const fraction = computed(() => (props.target > 0 ? clamp(props.eaten / props.target, 0, 1) : 0));
  const dashOffset = computed(() => CIRCUMFERENCE * (1 - fraction.value));
  const remaining = computed(() => Math.abs(props.target - props.eaten));

  return (
    <div class="relative mx-auto size-54">
      <svg class="size-full -rotate-90" viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="color-mix(in oklab, var(--color-ink) 9%, transparent)"
          stroke-width={STROKE}
        />
        <defs>
          <linearGradient id="ember-arc" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="var(--color-ember)" />
            <stop offset="100%" stop-color="var(--color-ember-bright)" />
          </linearGradient>
        </defs>
        <circle
          class="ring-arc"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={over.value ? 'var(--color-over)' : 'url(#ember-arc)'}
          stroke-width={STROKE}
          stroke-linecap="round"
          stroke-dasharray={String(CIRCUMFERENCE)}
          stroke-dashoffset={String(dashOffset.value)}
        />
      </svg>

      <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div class="text-display text-[52px] leading-none font-light tracking-tight">
          {fmtKcal(remaining.value)}
        </div>
        <div class={`mt-2 text-[13px] ${over.value ? 'text-over-bright' : 'text-ink-soft'}`}>
          {over.value ? 'ккал сверх цели' : 'ккал осталось'}
        </div>
        <div class="mt-0.5 text-xs text-ink-faint tnum">
          {`${fmtKcal(props.eaten)} из ${fmtKcal(props.target)}`}
        </div>
      </div>
    </div>
  );
}
