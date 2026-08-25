<script setup lang="ts">
import { computed } from 'vue';
import type { MonthTotal } from '../../entities/year';
import { monthShort } from '../../lib/month';
import { formatMoney } from '../../lib/money';

/**
 * Траты по месяцам: столбики против линии среднего.
 *
 * Рисунок — инлайн-SVG, а не набор `div` с высотами в процентах: у столбиков и
 * пунктирной линии среднего одна система координат, и в SVG она задаётся один
 * раз, а не пересчитывается вёрсткой на каждый элемент.
 *
 * Кликают по столбику НЕ в SVG: поверх лежит ряд обычных кнопок. Роль `button`
 * на `<rect>` пришлось бы объяснять скринридеру вручную и всё равно получить
 * цель, по которой трудно попасть пальцем.
 *
 * Цвета — переменные темы, а не значения: столбик красится акцентом, а вес ему
 * даёт ПРОЗРАЧНОСТЬ — выбранный в полную силу, пиковый чуть слабее, остальные
 * приглушены. Отдельный цвет для пика означал бы, что «дороже всего» — это
 * состояние вроде ошибки, а это просто максимум ряда.
 */
const { totals, max, average, selected, peak } = defineProps<{
  totals: readonly MonthTotal[];
  /** Верх шкалы, копейки: считается снаружи, чтобы график и подписи не разошлись. */
  max: number;
  /** Среднее за месяц, копейки. Ноль — линию не рисуем. */
  average: number;
  selected: string;
  /** Самый дорогой месяц года; отсутствует, если трат не было вовсе. */
  peak?: string;
}>();

defineEmits<{ select: [month: string] }>();

/** Система координат картинки: проценты по обеим осям, растягивается по месту. */
const VIEW = 100;
/** Доля ячейки под просвет между столбиками. */
const GAP_RATIO = 0.28;
/** Пенёк вместо столбика в месяц без трат: «не тратил» — тоже данные. */
const STUB = 0.8;

const bars = computed(() => {
  const slot = VIEW / Math.max(totals.length, 1);
  const gap = Math.min(slot * GAP_RATIO, 2);

  return totals.map((item, index) => {
    const height = item.count > 0 ? Math.max((item.total / max) * VIEW, STUB) : STUB;
    return {
      month: item.month,
      total: item.total,
      label: monthShort(item.month),
      x: index * slot + gap / 2,
      width: Math.max(slot - gap, 0.5),
      y: VIEW - height,
      height,
      empty: item.count === 0,
      peak: item.month === peak,
    };
  });
});

const averageY = computed(() => VIEW - (Math.min(average, max) / max) * VIEW);

function opacityOf(bar: { empty: boolean; month: string; peak: boolean }): number {
  if (bar.empty || bar.month === selected) return 1;
  return bar.peak ? 0.8 : 0.4;
}
</script>

<template>
  <div>
    <div class="relative h-40">
      <svg
        class="size-full"
        :viewBox="`0 0 ${VIEW} ${VIEW}`"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect
          v-for="bar in bars"
          :key="bar.month"
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
          :fill="bar.empty ? 'var(--line)' : 'var(--accent)'"
          :fill-opacity="opacityOf(bar)"
        />
        <!-- Линия среднего. Штрих не масштабируется: иначе он растягивался бы
             вместе с картинкой и в узком окне превращался в сплошной. -->
        <line
          v-if="average > 0"
          :x1="0"
          :x2="VIEW"
          :y1="averageY"
          :y2="averageY"
          stroke="var(--text-faint)"
          stroke-width="1"
          stroke-dasharray="3 3"
          vector-effect="non-scaling-stroke"
        />
      </svg>

      <div class="absolute inset-0 flex">
        <button
          v-for="bar in bars"
          :key="bar.month"
          type="button"
          class="pressable flex-1 rounded-sm hoverable"
          :class="bar.month === selected && 'bg-text/5'"
          :aria-label="bar.peak
            ? `${bar.label}: ${formatMoney(bar.total)}, самый дорогой месяц`
            : `${bar.label}: ${formatMoney(bar.total)}`"
          :aria-pressed="bar.month === selected"
          @click="$emit('select', bar.month)"
        />
      </div>
    </div>

    <div class="mt-2 flex" aria-hidden="true">
      <span
        v-for="bar in bars"
        :key="bar.month"
        class="flex-1 text-center text-[0.6875rem]"
        :class="bar.month === selected
          ? 'font-medium text-text'
          : bar.peak ? 'font-medium text-text-soft' : 'text-text-faint'"
      >
        {{ bar.label }}
      </span>
    </div>
  </div>
</template>
