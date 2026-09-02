<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Button, NumberField, Sheet } from '@brain/ui';
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

/** Порция и калории — `null`, пока поле стёрто: сохранять такое нечего. */
const amount = ref<number | null>(100);
const kcal = ref<number | null>(0);
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
  (food.value === null || amount.value === null || amount.value <= 0
    ? null
    : portionNutrients(food.value, amount.value)));

function save(): void {
  const current = entry.value;
  if (current === null) return;

  const patch = preview.value === null || amount.value === null
    ? { meal: meal.value, kcal: Math.max(0, Math.round(kcal.value ?? 0)) }
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

      <div v-if="food !== null" class="flex items-end gap-2">
        <NumberField
          v-model="amount"
          label="Порция"
          unit="г"
          :min="1"
          :step="10"
          :snap="false"
          class="w-36 shrink-0"
        />
        <span v-if="preview" class="tnum ml-auto pb-2.5 text-sm text-text-soft">
          {{ fmtKcal(preview.kcal) }} ккал
        </span>
      </div>

      <NumberField
        v-else
        v-model="kcal"
        label="Калорийность"
        unit="ккал"
        :min="0"
        :step="10"
        :snap="false"
        class="w-40"
      />
    </div>

    <template #footer>
      <div class="flex gap-2">
        <Button tone="danger" @click="remove">Удалить</Button>
        <Button tone="primary" class="flex-1" @click="save">Сохранить</Button>
      </div>
    </template>
  </Sheet>
</template>
