<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { ChevronRight, X } from 'lucide-vue-next';
import { Page, PageHeader, SegmentedControl, StatTile } from '@brain/ui';
import type { Segment } from '@brain/ui';
import { dayTitle, lastDays, shiftISODate, todayISO } from '@brain/std';
import { useActions, useEntries, useProfile, useWeights } from '../../db/composables';
import { chartMax, fillDays, macroShares, periodStats, summarizeDays, weightTrend } from '../../entities/stats';
import { fmtG, fmtKcal } from '../../lib/format';
import SectionTabs from '../SectionTabs.vue';
import KcalBars from '../KcalBars.vue';
import WeightSpark from './WeightSpark.vue';

/**
 * Статистика: калории по дням, средние за период, раскладка БЖУ и динамика веса.
 *
 * Все расчёты — в `entities/stats`: экран только выбирает период и раскладывает
 * готовые числа по плиткам. Так арифметику с пропущенными днями и пустыми
 * периодами проверяют тесты, а не глаз на живых данных.
 *
 * Плитки РАЗНОГО размера: график занимает две колонки и держит композицию,
 * средние идут мелкими плитками. Ряд одинаковых карточек читался бы как список
 * настроек, а не как сводка.
 *
 * Ширина — `wide`: это единственный экран дневника, которому лишние колонки
 * ИДУТ НА ПОЛЬЗУ. На 84 rem бенто раскладывается в четыре колонки, и главная
 * плитка вместе с двумя средними встаёт одной строкой вместо трёх экранов
 * прокрутки; мера для чтения тут не при чём — читать здесь нечего, здесь смотрят.
 */
/** Окна графика. Значения строковые: сегменты кита работают со строками. */
const PERIODS: readonly Segment[] = [
  { value: '7', label: '7 дн' },
  { value: '14', label: '14 дн' },
  { value: '30', label: '30 дн' },
];
/** С чем сравнивать вес: неделя — тот срок, на котором виден тренд, а не вода. */
const TREND_DAYS = 7;
/** Сколько замеров показывать списком: остальное — уже история, а не самочувствие. */
const WEIGHT_ROWS = 5;
/** Хвост для спарклайна: месяц замеров укладывается в 144 пикселя без каши. */
const SPARK_POINTS = 30;

const profile = useProfile().data;
const entries = useEntries();
const weights = useWeights();
const actions = useActions();

const period = ref('14');
const selected = ref(todayISO());

const target = computed(() => profile.value?.targetKcal ?? 2000);
const summaries = computed(() => summarizeDays(entries.value));
const days = computed(() => fillDays(lastDays(Number(period.value)), summaries.value));
const max = computed(() => chartMax(days.value, target.value));
const stats = computed(() => periodStats(days.value, target.value));
const shares = computed(() => (stats.value === null ? null : macroShares(stats.value)));
const selectedDay = computed(() => days.value.find(day => day.date === selected.value) ?? null);

// Период сузили, а выбранный день остался за его краем — возвращаем выбор на
// сегодня: пустая подпись под графиком выглядит как поломка, а не как выбор.
watch(days, (value) => {
  if (!value.some(day => day.date === selected.value)) selected.value = todayISO();
});

const latest = computed(() => weights.value.at(-1) ?? null);
const trend = computed(() => weightTrend(weights.value, shiftISODate(todayISO(), -TREND_DAYS)));
const sparkValues = computed(() => weights.value.slice(-SPARK_POINTS).map(item => item.kg));

/**
 * Хорошая динамика — та, что совпала с целью: минус на весах радует худеющего и
 * огорчает набирающего. Красить стрелку «вниз значит хорошо» значило бы решить
 * за человека, зачем он взвешивается.
 */
const trendTone = computed(() => {
  const value = trend.value;
  const goal = profile.value?.goal ?? 'maintain';
  if (value === null || goal === 'maintain' || value.deltaKg === 0) return 'text-text-faint';
  const wanted = goal === 'lose' ? value.deltaKg < 0 : value.deltaKg > 0;
  return wanted ? 'text-positive' : 'text-text-faint';
});
const lastWeights = computed(() => [...weights.value].reverse().slice(0, WEIGHT_ROWS));

const macroLegend = computed(() => {
  const value = stats.value;
  const split = shares.value;
  if (value === null || split === null) return [];
  return [
    { key: 'protein', label: 'Белки', grams: value.protein, share: split.protein, color: 'var(--macro-protein)' },
    { key: 'fat', label: 'Жиры', grams: value.fat, share: split.fat, color: 'var(--macro-fat)' },
    { key: 'carbs', label: 'Углеводы', grams: value.carbs, share: split.carbs, color: 'var(--macro-carbs)' },
  ];
});
</script>

<template>
  <Page width="list">
    <SectionTabs class="mb-4" />

    <PageHeader title="Статистика" :subtitle="`Норма ${fmtKcal(target)} ккал в день`">
      <template #action>
        <SegmentedControl v-model="period" label="Окно графика" :segments="PERIODS" />
      </template>
    </PageHeader>

    <!--
      Бенто: график на две колонки, средние — мелкими плитками. Сетка на
      `auto-fit` без брейкпоинтов, число колонок считает браузер.
    -->
    <section class="grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-3">
      <article class="rounded-card border border-line bg-surface p-4 sm:col-span-2">
        <header class="mb-3 flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-xs font-medium tracking-wide text-text-faint uppercase">Калории по дням</h2>
            <p v-if="stats !== null" class="text-display mt-1.5 text-4xl leading-none text-text">
              {{ fmtKcal(stats.kcal) }}
            </p>
            <p v-if="stats !== null" class="mt-1 text-xs text-text-faint">
              {{ `ккал в среднем · дней с записями ${stats.trackedDays} из ${period}` }}
            </p>
          </div>

          <RouterLink
            v-if="selectedDay !== null && stats !== null"
            :to="{ name: 'kcal:diary', query: { date: selectedDay.date } }"
            class="pressable flex shrink-0 items-center gap-1 rounded-control px-2 py-1.5 text-right
                   text-xs text-text-soft hoverable"
          >
            <span>
              <span class="block">{{ dayTitle(selectedDay.date) }}</span>
              <span v-if="selectedDay.entries > 0" class="tnum block text-text-faint">
                {{ `${fmtKcal(selectedDay.kcal)} ккал · Б ${fmtG(selectedDay.protein)}` }}
              </span>
              <span v-else class="block text-text-faint">нет записей</span>
            </span>
            <ChevronRight class="size-4 shrink-0 text-text-faint" />
          </RouterLink>
        </header>

        <KcalBars
          v-if="stats !== null"
          :days="days"
          :target="target"
          :max="max"
          :selected="selected"
          @select="value => selected = value"
        />

        <!-- Ось без данных — не график: вместо пустой сетки объясняем, откуда
             возьмутся столбики. -->
        <p v-else class="py-8 text-center text-sm leading-relaxed text-text-faint">
          За этот период записей нет.<br>
          Столбики появятся, как только в дневнике будет заполнен хотя бы один день.
        </p>
      </article>

      <StatTile
        v-if="stats !== null"
        :value="fmtG(stats.protein)"
        label="белка в день, г"
      />
      <StatTile
        v-if="stats !== null"
        :value="`${stats.onTargetShare}%`"
        label="дней в пределах нормы"
      />

      <article v-if="shares !== null" class="rounded-card border border-line bg-surface p-4 sm:col-span-2">
        <h2 class="mb-3 text-xs font-medium tracking-wide text-text-faint uppercase">
          {{ `Белки, жиры, углеводы · в среднем за ${stats?.trackedDays ?? 0} дн` }}
        </h2>

        <div class="flex h-2.5 overflow-hidden rounded-full bg-sunken">
          <div
            v-for="macro in macroLegend"
            :key="macro.key"
            :style="{ width: `${macro.share}%`, background: macro.color }"
          />
        </div>

        <dl class="mt-3 grid grid-cols-3 gap-2">
          <div v-for="macro in macroLegend" :key="macro.key">
            <dt class="flex items-center gap-1.5 text-[0.6875rem] tracking-wide text-text-faint uppercase">
              <span class="size-1.5 shrink-0 rounded-full" :style="{ background: macro.color }" />
              {{ macro.label }}
            </dt>
            <!-- Единица возвращается к текстовой гарнитуре: `text-display`
                 наследуется внутрь, и «г · 24%» гротеском выглядит сбоем. -->
            <dd class="text-display mt-1 text-base leading-none text-text">
              {{ fmtG(macro.grams) }}
              <span class="tnum font-text text-[0.6875rem] tracking-normal text-text-faint">
                {{ `г · ${macro.share}%` }}
              </span>
            </dd>
          </div>
        </dl>
      </article>

      <article class="rounded-card border border-line bg-surface p-4 sm:col-span-2">
        <h2 class="mb-3 text-xs font-medium tracking-wide text-text-faint uppercase">Вес</h2>

        <div v-if="latest !== null" class="flex items-end justify-between gap-3">
          <div>
            <p class="text-display text-4xl leading-none text-text">
              {{ fmtG(latest.kg) }}
              <span class="font-text text-sm tracking-normal text-text-faint">кг</span>
            </p>
            <p v-if="trend !== null" class="tnum mt-1.5 text-xs" :class="trendTone">
              {{ `${trend.deltaKg > 0 ? '+' : ''}${fmtG(trend.deltaKg)} кг с ${dayTitle(trend.fromDate).toLocaleLowerCase('ru')}` }}
            </p>
          </div>
          <WeightSpark :values="sparkValues" />
        </div>

        <p v-else class="text-sm leading-relaxed text-text-faint">
          Замеров пока нет. Здесь появятся текущий вес, линия за месяц и разница за
          неделю — записать вес можно
          <RouterLink :to="{ name: 'kcal:profile' }" class="text-accent hover:underline">в профиле</RouterLink>.
        </p>

        <ul v-if="lastWeights.length > 0" class="mt-3 divide-y divide-line border-t border-line">
          <li
            v-for="log in lastWeights"
            :key="log.id"
            class="flex items-center gap-3 py-1.5 text-sm"
          >
            <span class="min-w-0 flex-1 truncate text-text-soft">{{ dayTitle(log.date) }}</span>
            <span class="tnum shrink-0 text-text">{{ `${fmtG(log.kg)} кг` }}</span>
            <button
              type="button"
              :aria-label="`Удалить замер за ${log.date}`"
              class="pressable grid size-7 shrink-0 place-items-center rounded-full text-text-faint
                     hover:bg-danger-soft hover:text-danger"
              @click="actions.removeWeight(log.id)"
            >
              <X class="size-3.5" />
            </button>
          </li>
        </ul>

        <p class="mt-3 text-xs leading-relaxed text-text-faint">
          Взвешивайтесь утром натощак и смотрите на тренд за неделю, а не на
          ежедневные колебания — вода и еда в желудке шумят на ±1 кг.
        </p>
      </article>
    </section>
  </Page>
</template>
