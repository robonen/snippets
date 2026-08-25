<script setup lang="ts">
import { computed } from 'vue';
import { ArrowDown, ArrowUp } from 'lucide-vue-next';

/**
 * Число и его подпись — плитка сводки: «1 840 ккал», «7 задач», «−1,2 кг».
 *
 * Дельта приходит уже посчитанной и отформатированной: кит не знает, что
 * считается ростом. Направление задаётся отдельно (`deltaTone`), потому что
 * «меньше» — это хорошо для веса и плохо для накоплений, и вывести знак из
 * числа значило бы угадать домен.
 */
type DeltaTone = 'neutral' | 'positive' | 'negative';

const { deltaTone = 'neutral', deltaDirection } = defineProps<{
  /** Главное значение — уже отформатированное: «1 840», «12,5 км». */
  value: string;
  label: string;
  /** Изменение: «+120», «−3 %». */
  delta?: string;
  /** Цвет дельты. Что считать хорошим — решает вызывающий. */
  deltaTone?: DeltaTone;
  /** Стрелка рядом с дельтой. Без неё дельта — просто текст. */
  deltaDirection?: 'up' | 'down';
}>();

const DELTA_TONES: Record<DeltaTone, string> = {
  neutral: 'text-text-faint',
  positive: 'text-positive',
  negative: 'text-danger',
};

const arrow = computed(() => (deltaDirection === 'up' ? ArrowUp : deltaDirection === 'down' ? ArrowDown : undefined));
</script>

<template>
  <!--
    Содержимое прижато к низу, а подпись — к верху. В бенто плитка тянется по
    высоте ряда: рядом с высоким графиком она становится вдвое выше своего
    текста, и прижатое к верху число оставляет под собой пустую половину.
    Разнесённые края читаются как намеренная плитка, а не как недогруженная.
  -->
  <div class="flex flex-col justify-between gap-3 rounded-card border border-line bg-surface p-3.5">
    <p class="text-xs text-text-faint">{{ label }}</p>

    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <p class="tnum text-xl font-semibold tracking-tight text-text">{{ value }}</p>

      <p v-if="delta" class="tnum flex items-center gap-1 text-xs" :class="DELTA_TONES[deltaTone]">
        <component :is="arrow" v-if="arrow" class="size-3.5" />
        {{ delta }}
      </p>
    </div>
  </div>
</template>
