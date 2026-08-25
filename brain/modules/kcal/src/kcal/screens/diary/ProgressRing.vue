<script setup lang="ts">
import { computed } from 'vue';
import { clamp } from '@robonen/stdlib';
import { fmtKcal } from '../../lib/format';

/**
 * Главный индикатор дня: съедено против цели, в центре — остаток.
 * При переборе дуга замыкается и меняет цвет, остаток становится «сверх цели».
 *
 * Остаток набран крупно и дисплейной гарнитурой: это единственное число, ради
 * которого дневник открывают днём, и набранное подписью оно теряется среди
 * подписей.
 */
const { eaten, target } = defineProps<{ eaten: number; target: number }>();

const SIZE = 216;
const RADIUS = 92;
const STROKE = 12;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const over = computed(() => eaten > target);
const fraction = computed(() => (target > 0 ? clamp(eaten / target, 0, 1) : 0));
const dashOffset = computed(() => CIRCUMFERENCE * (1 - fraction.value));
const remaining = computed(() => Math.abs(target - eaten));
</script>

<template>
  <!-- Размер в `min()`, а не фиксированный: на 320-пиксельном экране кольцо в
       15 rem вылезло бы за поля вместе с числом внутри. -->
  <div class="relative mx-auto size-[min(15rem,68vw)]">
    <svg class="size-full -rotate-90" :viewBox="`0 0 ${SIZE} ${SIZE}`" aria-hidden="true">
      <circle
        :cx="SIZE / 2"
        :cy="SIZE / 2"
        :r="RADIUS"
        fill="none"
        stroke="var(--sunken)"
        :stroke-width="STROKE"
      />
      <circle
        class="ring-arc"
        :cx="SIZE / 2"
        :cy="SIZE / 2"
        :r="RADIUS"
        fill="none"
        :stroke="over ? 'var(--danger)' : 'var(--accent)'"
        :stroke-width="STROKE"
        stroke-linecap="round"
        :stroke-dasharray="CIRCUMFERENCE"
        :stroke-dashoffset="dashOffset"
      />
    </svg>

    <div class="absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
      <!-- Кегль в `clamp`, а не фиксированный: «1 840» набрано широким
           гротеском, и на узком экране постоянные 3,25 rem вылезли бы за дугу. -->
      <p class="text-display text-[clamp(2.25rem,10.5vw,3rem)] leading-none text-text">
        {{ fmtKcal(remaining) }}
      </p>
      <p
        class="mt-2 text-xs font-medium tracking-wide uppercase"
        :class="over ? 'text-danger' : 'text-text-faint'"
      >
        {{ over ? 'ккал сверх цели' : 'ккал осталось' }}
      </p>
      <p class="tnum mt-1.5 text-xs text-text-faint">
        {{ `${fmtKcal(eaten)} из ${fmtKcal(target)}` }}
      </p>
    </div>
  </div>
</template>
