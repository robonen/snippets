<script setup lang="ts">
import { computed } from 'vue';
import { ProgressIndicator, ProgressRoot } from '@robonen/primitives';

/**
 * Полоса «сколько из скольких»: прогресс, дневная норма, заполненность.
 *
 * ARIA целиком на примитиве (`progressbar`, `aria-valuenow`, состояние в
 * `data-state`); здесь — геометрия, цвет и подписи. Цвет приходит снаружи
 * переменной: значение полосы доменное, а кит домена не знает.
 */
const {
  value,
  max = 100,
  color = 'var(--accent)',
  overColor = 'var(--danger)',
} = defineProps<{
  value: number;
  max?: number;
  label?: string;
  /** Подпись справа: «1 840 / 2 000». */
  caption?: string;
  color?: string;
  overColor?: string;
}>();

const over = computed(() => value > max);
// Клампим только ШИРИНУ: значение остаётся правдивым для ARIA и подписи.
const percent = computed(() => (max > 0 ? Math.min((value / max) * 100, 100) : 0));
const fill = computed(() => (over.value ? overColor : color));
</script>

<template>
  <div>
    <div v-if="label || caption" class="mb-1.5 flex items-baseline justify-between gap-2">
      <span v-if="label" class="text-xs text-text-soft">{{ label }}</span>
      <span v-if="caption" class="tnum text-xs text-text-faint">{{ caption }}</span>
    </div>

    <ProgressRoot
      :model-value="Math.min(value, max)"
      :max="max"
      class="h-1.5 w-full overflow-hidden rounded-full bg-sunken"
    >
      <ProgressIndicator
        class="h-full rounded-full transition-[width,background-color] duration-(--duration-sheet) ease-out
               motion-reduce:transition-none"
        :style="{ width: `${percent}%`, backgroundColor: fill }"
      />
    </ProgressRoot>
  </div>
</template>
