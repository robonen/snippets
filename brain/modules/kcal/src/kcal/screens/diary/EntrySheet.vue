<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Button, Sheet } from '@brain/ui';
import { useActions, useEntries, useFoods } from '../../db/composables';
import { portionNutrients } from '../../entities/nutrition';
import { MEALS, MEAL_LABELS } from '../../entities/entry';
import { fmtKcal } from '../../lib/format';
import type { Meal } from '../../entities/entry';

/**
 * Правка записи: порция, приём пищи, удаление.
 *
 * Нутриенты пересчитываются только если запись связана с продуктом каталога.
 * У быстрой записи «только ккал» пересчитывать не из чего — там правится
 * сама цифра.
 */
const { entryId } = defineProps<{ entryId: string | null }>();
const open = defineModel<boolean>('open', { default: false });

const entries = useEntries();
const foods = useFoods();
const actions = useActions();

const amount = ref(100);
const kcal = ref(0);
const meal = ref<Meal>('breakfast');

const entry = computed(() => entries.value.find(item => item.id === entryId) ?? null);
const food = computed(() => {
  const id = entry.value?.foodId;
  return id === undefined ? null : foods.value.find(item => item.id === id) ?? null;
});

watch([open, entry], () => {
  const current = entry.value;
  if (!open.value || current === null) return;
  amount.value = current.amountG ?? 100;
  kcal.value = current.kcal;
  meal.value = current.meal;
}, { immediate: true });

const preview = computed(() =>
  (food.value === null ? null : portionNutrients(food.value, amount.value)));

function save(): void {
  const current = entry.value;
  if (current === null) return;

  const patch = preview.value === null
    ? { meal: meal.value, kcal: Math.max(0, Math.round(kcal.value)) }
    : { meal: meal.value, amountG: amount.value, ...preview.value };

  actions.updateEntry(current.id, patch);
  open.value = false;
}

function remove(): void {
  if (entry.value !== null) actions.removeEntry(entry.value.id);
  open.value = false;
}
</script>

<template>
  <Sheet v-model:open="open" :title="entry?.name ?? 'Запись'">
    <div v-if="entry !== null" class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-1.5">
        <Button
          v-for="option in MEALS"
          :key="option"
          size="sm"
          :tone="meal === option ? 'primary' : 'quiet'"
          @click="meal = option"
        >
          {{ MEAL_LABELS[option] }}
        </Button>
      </div>

      <div v-if="food !== null" class="flex items-center gap-2">
        <input
          v-model.number="amount"
          type="number"
          min="1"
          step="10"
          aria-label="Порция в граммах"
          class="h-10 w-24 rounded-control border border-line bg-surface px-3 text-sm text-text"
        >
        <span class="text-sm text-text-soft">г</span>
        <span v-if="preview" class="tnum ml-auto text-sm text-text-soft">
          {{ fmtKcal(preview.kcal) }} ккал
        </span>
      </div>

      <div v-else class="flex items-center gap-2">
        <input
          v-model.number="kcal"
          type="number"
          min="0"
          step="10"
          aria-label="Калорийность"
          class="h-10 w-24 rounded-control border border-line bg-surface px-3 text-sm text-text"
        >
        <span class="text-sm text-text-soft">ккал</span>
      </div>
    </div>

    <template #footer>
      <div class="flex gap-2">
        <Button tone="danger" @click="remove">Удалить</Button>
        <Button tone="primary" block @click="save">Сохранить</Button>
      </div>
    </template>
  </Sheet>
</template>
