<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-vue-next';
import { Button, EmptyState, Page } from '@brain/ui';
import { dayTitle, lastDays, shiftISODate, todayISO } from '@brain/std';
import { useEntries, useFoods, useProfile } from '../../db/composables';
import { sumNutrients } from '../../entities/nutrition';
import { fmtAmount } from '../../entities/food';
import { chartMax, fillDays, summarizeDays } from '../../entities/stats';
import { MEALS, MEAL_LABELS } from '../../entities/entry';
import { fmtKcal } from '../../lib/format';
import type { Entry, Meal } from '../../entities/entry';
import ProgressRing from './ProgressRing.vue';
import MacroBar from './MacroBar.vue';
import EntrySheet from './EntrySheet.vue';
import AddSheet from '../add/AddSheet.vue';
import SectionTabs from '../SectionTabs.vue';
import KcalBars from '../KcalBars.vue';

/**
 * Дневник за день: кольцо, макросы, полоса недели и записи по приёмам пищи.
 *
 * Открытый день — состояние САМОГО экрана: каркас общий на все модули и про дни
 * дневника не знает. Но день умеет приезжать ссылкой `?date=…` — из статистики
 * туда ведёт столбик графика, и без адреса такой переход был бы невозможен.
 *
 * Приём пищи по умолчанию для кнопки «+» выбирается по времени суток: в
 * девять утра почти наверняка добавляют завтрак, и один тап экономится.
 *
 * Ширина — `list`: экран про список приёмов, а не про сводку. С `xl` кольцо и
 * записи встают РЯДОМ: остаток дня — то, ради чего сюда возвращаются в течение
 * дня, и на широком экране ему незачем уезжать вверх за край при первом же
 * десятке записей.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Длина полосы под кольцом: неделя — тот срок, который держат в голове. */
const WEEK_DAYS = 7;

const route = useRoute();
const asked = route.query['date'];
const date = shallowRef(typeof asked === 'string' && ISO_DATE.test(asked) ? asked : todayISO());

const profile = useProfile().data;
const all = useEntries();
const entries = computed(() => all.value.filter(entry => entry.date === date.value));

// Каталог нужен только ради pieceGrams — чтобы подписывать порции «2 шт · 110 г».
const foods = useFoods();
const pieceByFoodId = computed(() => {
  const map = new Map<string, number | undefined>();
  for (const food of foods.value) map.set(food.id, food.pieceGrams);
  return map;
});

const totals = computed(() => sumNutrients(entries.value));
const isToday = computed(() => date.value === todayISO());
const target = computed(() => profile.value?.targetKcal ?? 2000);

// Полоса недели кончается ОТКРЫТЫМ днём, а не сегодняшним: пролистав на неделю
// назад, человек ждёт увидеть контекст того дня, а не всё ту же текущую неделю.
const week = computed(() => fillDays(lastDays(WEEK_DAYS, date.value), summarizeDays(all.value)));
const weekMax = computed(() => chartMax(week.value, target.value));

const meals = computed(() => {
  const byMeal = new Map<Meal, Entry[]>();
  for (const meal of MEALS) byMeal.set(meal, []);
  for (const entry of entries.value) byMeal.get(entry.meal)?.push(entry);
  return MEALS
    .map(meal => ({
      meal,
      label: MEAL_LABELS[meal],
      list: byMeal.get(meal) ?? [],
    }))
    .filter(group => group.list.length > 0)
    .map(group => ({
      ...group,
      kcal: group.list.reduce((acc, entry) => acc + entry.kcal, 0),
    }));
});

function shift(days: number): void {
  date.value = shiftISODate(date.value, days);
}

const addOpen = ref(false);
const addMeal = ref<Meal>('breakfast');
const editId = ref<string | null>(null);
const editOpen = ref(false);

function mealByHour(hour: number): Meal {
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

function openAdd(meal?: Meal): void {
  addMeal.value = meal ?? mealByHour(new Date().getHours());
  addOpen.value = true;
}

function openEntry(id: string): void {
  editId.value = id;
  editOpen.value = true;
}
</script>

<template>
  <Page width="list">
    <SectionTabs class="mb-4" />

    <!--
      Две колонки с `xl`: слева опора (кольцо, макросы, неделя), справа записи.
      Ниже они честно встают друг под друга — кольцу нужно 15 rem, и в колонке
      уже этого оно превратилось бы в кружок.

      Опора ЛИПКАЯ: список приёмов за плотный день длиннее экрана, а остаток
      калорий нужен как раз в момент, когда листаешь съеденное.
    -->
    <div class="grid gap-3 xl:grid-cols-2 xl:items-start">
      <!--
        Опора экрана — одна поверхность: кольцо, макросы и неделя. Три отдельные
        карточки дали бы ровно тот ряд одинаковых прямоугольников, из-за которого
        экран читается как список настроек.
      -->
      <section
        class="@container overflow-hidden rounded-card border border-line bg-surface xl:sticky xl:top-6"
      >
        <header class="flex items-center justify-between gap-2 px-2 pt-2">
          <button
            type="button"
            aria-label="Предыдущий день"
            class="pressable grid size-10 place-items-center rounded-control text-text-faint hoverable
                   hover:text-text"
            @click="shift(-1)"
          >
            <ChevronLeft class="size-5" />
          </button>

          <div class="text-center">
            <h1 class="text-sm font-medium text-text">{{ dayTitle(date) }}</h1>
            <button
              v-if="!isToday"
              type="button"
              class="text-xs text-accent hover:underline"
              @click="date = todayISO()"
            >
              вернуться к сегодня
            </button>
          </div>

          <button
            type="button"
            aria-label="Следующий день"
            class="pressable grid size-10 place-items-center rounded-control text-text-faint hoverable
                   hover:text-text"
            @click="shift(1)"
          >
            <ChevronRight class="size-5" />
          </button>
        </header>

        <!-- `@container`, а не брейкпоинты окна: на широком экране кольцо и
             макросы встают рядом по СВОЕЙ ширине, и та же вёрстка работает, если
             дневник когда-нибудь окажется в колонке поуже. -->
        <div class="flex flex-col gap-5 px-5 pt-2 pb-5 @lg:flex-row @lg:items-center @lg:gap-7">
          <ProgressRing
            class="shrink-0"
            :eaten="totals.kcal"
            :target="target"
          />

          <div class="flex gap-4 @lg:min-w-0 @lg:flex-1 @lg:flex-col @lg:gap-4">
            <MacroBar label="Белки" color="protein" :value="totals.protein" :target="profile?.targetProtein ?? 120" />
            <MacroBar label="Жиры" color="fat" :value="totals.fat" :target="profile?.targetFat ?? 70" />
            <MacroBar label="Углеводы" color="carbs" :value="totals.carbs" :target="profile?.targetCarbs ?? 250" />
          </div>
        </div>

        <div class="border-t border-line px-4 py-3">
          <h2 class="mb-2 text-xs font-medium tracking-wide text-text-faint uppercase">Неделя</h2>
          <KcalBars
            dense
            :days="week"
            :target="target"
            :max="weekMax"
            :selected="date"
            @select="value => date = value"
          />
        </div>
      </section>

      <!--
        Приёмы пищи — ОДНА поверхность с разделителями, а не карточка на каждый:
        четыре карточки одинакового веса под опорой ломают ритм «крупное →
        плотное» ровно там, где он начинается.
      -->
      <div v-if="meals.length > 0" class="overflow-hidden rounded-card border border-line bg-surface">
        <section
          v-for="(group, index) in meals"
          :key="group.meal"
          class="stagger border-b border-line"
          :style="{ '--stagger-index': index }"
        >
          <header class="flex items-center gap-2 px-4 pt-3.5 pb-2">
            <h2 class="text-xs font-medium tracking-wide text-text-faint uppercase">{{ group.label }}</h2>
            <span class="tnum ml-auto text-xs text-text-faint">{{ `${fmtKcal(group.kcal)} ккал` }}</span>
            <button
              type="button"
              :aria-label="`Добавить в приём «${group.label}»`"
              class="pressable -mr-1.5 grid size-7 place-items-center rounded-control text-text-faint hoverable
                     hover:text-text"
              @click="openAdd(group.meal)"
            >
              <Plus class="size-4" />
            </button>
          </header>

          <ul class="divide-y divide-line border-t border-line">
            <li v-for="entry in group.list" :key="entry.id">
              <button
                type="button"
                class="pressable flex w-full items-center gap-3 px-4 py-2.5 text-left hoverable"
                @click="openEntry(entry.id)"
              >
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm text-text">{{ entry.name }}</span>
                  <span class="mt-0.5 block text-xs text-text-faint">
                    {{ fmtAmount(entry.amountG, entry.foodId !== undefined ? pieceByFoodId.get(entry.foodId) : undefined) }}
                  </span>
                </span>
                <span class="tnum shrink-0 text-sm text-text">{{ fmtKcal(entry.kcal) }}</span>
              </button>
            </li>
          </ul>
        </section>

        <button
          type="button"
          class="pressable flex w-full items-center gap-2 px-4 py-3 text-sm text-accent hoverable"
          @click="openAdd()"
        >
          <Plus class="size-4" />
          Добавить
        </button>
      </div>

      <EmptyState
        v-else
        title="За этот день записей нет"
        description="Каждая запись — продукт из каталога и вес порции; кольцо наверху считает остаток от дневной нормы. Недавние продукты будут в списке первыми."
      >
        <template #action>
          <Button tone="primary" @click="openAdd()">
            <Plus class="size-4" />
            Добавить
          </Button>
        </template>
      </EmptyState>
    </div>

    <AddSheet v-model:open="addOpen" :meal="addMeal" :date="date" />
    <EntrySheet v-model:open="editOpen" :entry-id="editId" />
  </Page>
</template>
