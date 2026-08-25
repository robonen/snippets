<script setup lang="ts">
import { computed } from 'vue';
import { dayShort } from '@brain/std';
import { fmtKcal, fmtWeekday } from '../lib/format';
import type { DaySummary } from '../entities/stats';

/**
 * Калории по дням: столбики против линии дневной нормы.
 *
 * Живёт на общем уровне `screens/`, а не внутри статистики: тот же рисунок несёт
 * полосу недели в дневнике, и импорт из соседнего экрана связал бы два экрана
 * между собой вместо того, чтобы поднять общее наверх.
 *
 * Рисунок — инлайн-SVG, а не набор `div` с высотами в процентах: у столбиков и
 * пунктирной линии цели одна система координат, и в SVG она задаётся один раз,
 * а не пересчитывается вёрсткой на каждый элемент.
 *
 * Кликают по столбику НЕ в SVG: поверх лежит ряд обычных кнопок. Роль
 * `button` на `<rect>` пришлось бы объяснять скринридеру вручную и всё равно
 * получить цель, по которой трудно попасть пальцем.
 */
const { days, target, max, dense = false } = defineProps<{
  days: readonly DaySummary[];
  target: number;
  /** Верх шкалы, ккал: считается снаружи, чтобы график и подписи не разошлись. */
  max: number;
  selected: string | null;
  /**
   * Полоса недели: низкие столбики и подпись под каждым.
   *
   * Подписи по краям («5.08 … 12.08») читаются только на длинном окне; на семи
   * днях рядом с кольцом нужен ответ «какой это был день», и он помещается
   * ровно потому, что столбиков семь, а не тридцать.
   */
  dense?: boolean;
}>();

defineEmits<{ select: [date: string] }>();

/** Система координат картинки: проценты по обеим осям, растягивается по месту. */
const VIEW = 100;
/** Доля ячейки под просвет между столбиками. */
const GAP_RATIO = 0.25;
/** Пенёк вместо столбика в дни без записей: «не ел» — тоже данные. */
const STUB = 0.8;

const bars = computed(() => {
  const slot = VIEW / Math.max(days.length, 1);
  const gap = Math.min(slot * GAP_RATIO, 1.5);

  return days.map((day, index) => {
    const height = day.entries > 0 ? Math.max((day.kcal / max) * VIEW, STUB) : STUB;
    return {
      date: day.date,
      kcal: day.kcal,
      x: index * slot + gap / 2,
      width: Math.max(slot - gap, 0.5),
      y: VIEW - height,
      height,
      empty: day.entries === 0,
      over: day.kcal > target,
    };
  });
});

const targetY = computed(() => VIEW - (target / max) * VIEW);

const edges = computed(() => ({
  first: days[0]?.date,
  last: days.at(-1)?.date,
}));

function fillOf(bar: { empty: boolean; over: boolean }): string {
  if (bar.empty) return 'var(--line)';
  if (bar.over) return 'var(--danger)';
  return 'var(--accent)';
}
</script>

<template>
  <div>
    <div class="relative" :class="dense ? 'h-14' : 'h-44'">
      <svg
        class="size-full"
        :viewBox="`0 0 ${VIEW} ${VIEW}`"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect
          v-for="bar in bars"
          :key="bar.date"
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
          :fill="fillOf(bar)"
          :fill-opacity="bar.empty || bar.date === selected ? 1 : 0.55"
        />
        <!-- Линия нормы. Штрих не масштабируется: иначе он растягивался бы
             вместе с картинкой и в узком окне превращался в сплошной. -->
        <line
          :x1="0"
          :x2="VIEW"
          :y1="targetY"
          :y2="targetY"
          stroke="var(--text-faint)"
          stroke-width="1"
          stroke-dasharray="3 3"
          vector-effect="non-scaling-stroke"
        />
      </svg>

      <div class="absolute inset-0 flex">
        <button
          v-for="bar in bars"
          :key="bar.date"
          type="button"
          class="pressable flex-1 rounded-sm hoverable"
          :class="bar.date === selected && 'bg-text/5'"
          :aria-label="`${dayShort(bar.date)}: ${fmtKcal(bar.kcal)} ккал`"
          :aria-pressed="bar.date === selected"
          @click="$emit('select', bar.date)"
        />
      </div>
    </div>

    <div v-if="dense" class="mt-1 flex" aria-hidden="true">
      <span
        v-for="bar in bars"
        :key="bar.date"
        class="flex-1 text-center text-[0.625rem]"
        :class="bar.date === selected ? 'font-medium text-text' : 'text-text-faint'"
      >
        {{ fmtWeekday(bar.date) }}
      </span>
    </div>

    <div v-else class="tnum mt-1.5 flex justify-between text-[0.625rem] text-text-faint">
      <span>{{ edges.first === undefined ? '' : dayShort(edges.first) }}</span>
      <span>{{ edges.last === undefined ? '' : dayShort(edges.last) }}</span>
    </div>
  </div>
</template>
