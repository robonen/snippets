<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Button, Sheet } from '@brain/ui';
import { todayISO } from '@brain/std';
import { useActions, useFoods } from '../../db/composables';
import { defaultAmount } from '../../entities/food';
import { portionNutrients } from '../../entities/nutrition';
import { MEAL_LABELS } from '../../entities/entry';
import { fmtKcal } from '../../lib/format';
import type { Food } from '../../entities/food';
import type { Meal } from '../../entities/entry';

/**
 * Добавление записи: выбор продукта из каталога и порция.
 *
 * Каталог сортируется по частоте и свежести использования, а не по алфавиту:
 * в дневнике питания одни и те же десять продуктов повторяются неделями, и
 * алфавит заставлял бы искать их заново каждый раз.
 */
const { meal, date } = defineProps<{ meal: Meal; date: string }>();
const open = defineModel<boolean>('open', { default: false });

const foods = useFoods();
const actions = useActions();

const query = ref('');
const picked = ref<Food | null>(null);
const amount = ref(100);

watch(open, (value) => {
  if (!value) {
    query.value = '';
    picked.value = null;
  }
});

const matches = computed(() => {
  const text = query.value.trim().toLowerCase();
  const list = [...foods.value];
  list.sort((a, b) => (b.lastUsedAt - a.lastUsedAt) || (b.usedCount - a.usedCount));
  if (text === '') return list.slice(0, 30);
  return list.filter(food => food.name.toLowerCase().includes(text)).slice(0, 30);
});

const preview = computed(() =>
  (picked.value === null ? null : portionNutrients(picked.value, amount.value)));

function pick(food: Food): void {
  picked.value = food;
  amount.value = defaultAmount(food);
}

function add(): void {
  const food = picked.value;
  const nutrients = preview.value;
  if (food === null || nutrients === null) return;

  actions.addEntry({
    id: crypto.randomUUID(),
    date,
    meal,
    foodId: food.id,
    name: food.name,
    amountG: amount.value,
    ...nutrients,
    createdAt: Date.now(),
  });
  open.value = false;
}

/** Быстрая запись «только ккал»: еда вне каталога, считать БЖУ не из чего. */
function addQuick(): void {
  const kcal = Number(query.value.replace(',', '.'));
  if (!Number.isFinite(kcal) || kcal <= 0) return;

  actions.addEntry({
    id: crypto.randomUUID(),
    date,
    meal,
    name: `${fmtKcal(kcal)} ккал`,
    kcal: Math.round(kcal),
    protein: 0,
    fat: 0,
    carbs: 0,
    createdAt: Date.now(),
  });
  open.value = false;
}

const quickKcal = computed(() => {
  const value = Number(query.value.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
});
</script>

<template>
  <Sheet v-model:open="open" :title="MEAL_LABELS[meal]" :description="date === todayISO() ? 'сегодня' : date">
    <div v-if="picked === null" class="flex flex-col gap-3">
      <input
        v-model="query"
        type="search"
        inputmode="text"
        placeholder="Продукт или сразу число ккал"
        aria-label="Поиск продукта"
        class="h-10 w-full rounded-control border border-line bg-surface px-3 text-sm text-text
               placeholder:text-text-faint"
      >

      <Button v-if="quickKcal !== null" tone="primary" block @click="addQuick">
        Записать {{ fmtKcal(quickKcal) }} ккал без продукта
      </Button>

      <ul class="flex flex-col divide-y divide-line">
        <li v-for="food in matches" :key="food.id">
          <button
            type="button"
            class="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-sunken"
            @click="pick(food)"
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm text-text">{{ food.name }}</span>
              <span class="mt-0.5 block text-xs text-text-faint">{{ food.category }}</span>
            </span>
            <span class="tnum shrink-0 text-sm text-text-soft">{{ fmtKcal(food.kcal) }}</span>
          </button>
        </li>
      </ul>

      <p v-if="matches.length === 0" class="py-6 text-center text-sm text-text-faint">
        Ничего не нашлось. Введите число — запишем как «только ккал».
      </p>
    </div>

    <div v-else class="flex flex-col gap-4">
      <div>
        <p class="text-sm font-medium text-text">{{ picked.name }}</p>
        <p class="mt-0.5 text-xs text-text-faint">на 100 г: {{ fmtKcal(picked.kcal) }} ккал</p>
      </div>

      <div class="flex items-center gap-2">
        <input
          v-model.number="amount"
          type="number"
          min="1"
          step="10"
          aria-label="Порция в граммах"
          class="h-10 w-24 rounded-control border border-line bg-surface px-3 text-sm text-text"
        >
        <span class="text-sm text-text-soft">г</span>
        <div class="flex gap-1.5">
          <Button
            v-for="step in [50, 100, 150, 200]"
            :key="step"
            size="sm"
            @click="amount = step"
          >
            {{ step }}
          </Button>
        </div>
      </div>

      <dl v-if="preview" class="grid grid-cols-4 gap-2 rounded-card bg-sunken p-3 text-center">
        <div v-for="cell in [
          { label: 'Ккал', value: preview.kcal },
          { label: 'Б', value: preview.protein },
          { label: 'Ж', value: preview.fat },
          { label: 'У', value: preview.carbs },
        ]" :key="cell.label">
          <dt class="text-xs text-text-faint">{{ cell.label }}</dt>
          <dd class="tnum mt-0.5 text-sm text-text">{{ cell.value }}</dd>
        </div>
      </dl>
    </div>

    <template v-if="picked !== null" #footer>
      <div class="flex gap-2">
        <Button block @click="picked = null">Назад</Button>
        <Button tone="primary" block :disabled="amount <= 0" @click="add">Добавить</Button>
      </div>
    </template>
  </Sheet>
</template>
