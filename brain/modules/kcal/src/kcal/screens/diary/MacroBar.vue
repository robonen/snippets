<script setup lang="ts">
import { Meter } from '@brain/ui';
import { fmtG } from '../../lib/format';

/**
 * Полоса «съедено/цель» по одному макронутриенту.
 *
 * Геометрия и ARIA — на `Meter` из кита; здесь остаётся только доменное: какой
 * это макрос, его цвет и как подписаны граммы.
 *
 * Съеденные граммы крупнее подписи: в паре «Белки / 82,5» смотрят на число, и
 * одинаковый кегль заставляет искать его глазами каждый раз.
 */
const COLORS = {
  protein: 'var(--macro-protein)',
  fat: 'var(--macro-fat)',
  carbs: 'var(--macro-carbs)',
} as const;

const { label, value, target, color } = defineProps<{
  label: string;
  value: number;
  target: number;
  color: keyof typeof COLORS;
}>();
</script>

<template>
  <div class="min-w-0 flex-1">
    <div class="flex items-center gap-1.5 truncate text-[0.6875rem] tracking-wide text-text-faint uppercase">
      <span class="size-1.5 shrink-0 rounded-full" :style="{ background: COLORS[color] }" />
      {{ label }}
    </div>

    <!-- Съедено и цель на РАЗНЫХ строках: в узкой колонке (три макроса в ряд на
         телефоне) «120,5 / 250 г» одной строкой не помещается и растягивает
         экран горизонтальной прокруткой. -->
    <p class="text-display mt-1 mb-1.5 truncate text-base leading-none text-text">{{ fmtG(value) }}</p>

    <Meter :value="value" :max="target" :color="COLORS[color]" />

    <p class="tnum mt-1 truncate text-[0.6875rem] text-text-faint">{{ `из ${fmtG(target)} г` }}</p>
  </div>
</template>
