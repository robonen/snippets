<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { EmptyState, StatTile } from '@brain/ui';
import { chartMax, compareTotals, monthlyTotals, yearStats } from '../../entities/year';
import type { MonthTotal } from '../../entities/year';
import { useExpenses } from '../../db/composables';
import { currentYear, monthTitle, shiftYear, yearOf } from '../../lib/month';
import { formatMoney } from '../../lib/money';
import YearBars from './YearBars.vue';

/**
 * Годовой обзор: помесячные суммы, среднее и сравнение соседних месяцев.
 *
 * Открытый год следует за открытым месяцем, а не живёт сам по себе: переключив
 * месяц на декабрь прошлого года и заглянув в «Год», ожидаешь увидеть ТОТ год,
 * а не текущий.
 *
 * Опора вкладки — сумма за год: тот же приём, что и в месяце, и по той же
 * причине. Ряд одинаковых плиток под шапкой не сообщал бы, что здесь главное.
 *
 * Раскладка — бенто, а не столбик: на широком экране год умещается в две
 * строки — итог со средними сверху, график и помесячный список рядом снизу, —
 * и сводка перестаёт быть лентой, которую надо прокручивать целиком.
 */
const { month } = defineProps<{ month: string }>();

const emit = defineEmits<{ 'open-month': [month: string] }>();

const expenses = useExpenses();

const year = shallowRef(yearOf(month));

watch(() => month, (value) => {
  year.value = yearOf(value);
});

const totals = computed(() => monthlyTotals(expenses.value, year.value));
const stats = computed(() => yearStats(totals.value));
const max = computed(() => chartMax(totals.value));

/** Месяцы с тратами, свежие сверху: список читают сверху вниз, а не по календарю. */
const rows = computed(() => [...totals.value]
  .filter(item => item.count > 0)
  .reverse());

const isCurrent = computed(() => year.value === currentYear());

function shift(step: number): void {
  year.value = shiftYear(year.value, step);
}

/** Изменение месяца к предыдущему — прямо в строке списка. */
function changeOf(item: MonthTotal): string {
  const index = totals.value.findIndex(entry => entry.month === item.month);
  const previous = totals.value[index - 1];
  if (previous === undefined || previous.total === 0) return `${item.count} записей`;

  const change = compareTotals(item.total, previous.total);
  const percent = change.share === null ? 0 : Math.round(change.share * 100);
  if (percent === 0) return `${item.count} записей · столько же`;
  return `${item.count} записей · ${percent > 0 ? '+' : '−'}${Math.abs(percent)}% к прошлому месяцу`;
}
</script>

<template>
  <!-- Сетка на `auto-fit` без брейкпоинтов: число колонок считает браузер, а
       крупные плитки берут по две — на одной колонке правило не срабатывает, и
       порядок остаётся тем же. -->
  <div class="grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-3">
    <!-- Опора вкладки: год, сумма и число месяцев с тратами. -->
    <section class="rounded-card border border-line bg-surface px-5 pt-2 pb-5 sm:col-span-2">
      <header class="-mx-3 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Предыдущий год"
          class="pressable grid size-10 place-items-center rounded-control text-text-faint hoverable
                 hover:text-text"
          @click="shift(-1)"
        >
          <ChevronLeft class="size-5" />
        </button>

        <div class="text-center">
          <h2 class="tnum text-xs font-medium tracking-wide text-text-faint uppercase">{{ year }}</h2>
          <button
            v-if="!isCurrent"
            type="button"
            class="text-xs text-accent hover:underline"
            @click="year = currentYear()"
          >
            вернуться к текущему
          </button>
        </div>

        <button
          type="button"
          aria-label="Следующий год"
          class="pressable grid size-10 place-items-center rounded-control text-text-faint hoverable
                 hover:text-text"
          @click="shift(1)"
        >
          <ChevronRight class="size-5" />
        </button>
      </header>

      <p class="text-display mt-2 text-center text-[clamp(2rem,9.5vw,3.5rem)] leading-none text-text">
        {{ formatMoney(stats.total) }}
      </p>
      <p class="mt-2.5 text-center text-xs text-text-faint">
        {{ stats.tracked === 0 ? 'за год трат нет' : `месяцев с тратами: ${stats.tracked} из 12` }}
      </p>
    </section>

    <!-- Плитки — прямые ячейки бенто, а не пара внутри своей сетки: рядом с
         опорой на две колонки они добирают строку до конца. -->
    <template v-if="stats.tracked > 0">
      <StatTile :value="formatMoney(stats.average)" label="в среднем за месяц с тратами" />
      <StatTile
        :value="stats.peak === undefined ? '—' : formatMoney(stats.peak.total)"
        :label="stats.peak === undefined ? 'самый дорогой месяц' : `дороже всего: ${monthTitle(stats.peak.month)}`"
      />
    </template>

    <section class="rounded-card border border-line bg-surface p-4 sm:col-span-2">
      <h2 class="mb-3 text-xs font-medium tracking-wide text-text-faint uppercase">По месяцам</h2>

      <YearBars
        v-if="stats.tracked > 0"
        :totals="totals"
        :max="max"
        :average="stats.average"
        :selected="month"
        :peak="stats.peak?.month"
        @select="value => emit('open-month', value)"
      />

      <!-- Ось без данных — не график: пустой год объясняется словами, а не
           двенадцатью пеньками на нулевой шкале. -->
      <p v-else class="py-8 text-center text-sm leading-relaxed text-text-faint">
        В {{ year }} году записанных трат нет.<br>
        Столбики появятся сами: годовой обзор считает то, что записано в месяцах.
      </p>
    </section>

    <div
      v-if="rows.length > 0"
      class="overflow-hidden rounded-card border border-line bg-surface sm:col-span-2"
    >
      <ul class="divide-y divide-line">
        <li v-for="item in rows" :key="item.month">
          <button
            type="button"
            class="pressable flex w-full items-center gap-3 px-4 py-2.5 text-left hoverable"
            @click="emit('open-month', item.month)"
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm text-text first-letter:uppercase">
                {{ monthTitle(item.month) }}
              </span>
              <span class="block truncate text-xs text-text-faint">{{ changeOf(item) }}</span>
            </span>
            <span class="tnum shrink-0 text-sm text-text">{{ formatMoney(item.total) }}</span>
          </button>
        </li>
      </ul>
    </div>

    <EmptyState
      v-else
      class="sm:col-span-2"
      title="За этот год трат нет"
      description="Годовой обзор наполняется сам: он складывает то, что записано в месяцах, и показывает, куда движется расход. Запишите первую трату во вкладке «Месяц»."
    />
  </div>
</template>
