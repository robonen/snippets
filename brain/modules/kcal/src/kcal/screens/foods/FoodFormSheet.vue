<script setup lang="ts">
import { ref, watch } from 'vue';
import { Button, Sheet, TextField } from '@brain/ui';
import { useActions } from '../../db/composables';
import type { Food, FoodDraft } from '../../entities/food';

/**
 * Карточка продукта: значения задаются на 100 г — так печатают на упаковке.
 *
 * `draft` — заготовка для НОВОГО продукта (например, из базы упаковок по
 * штрихкоду). Она не «продукт без id»: у неё нет истории использования, и
 * кнопки удаления у неё быть не должно — удалять нечего.
 */
const { food, draft = null } = defineProps<{ food: Food | null; draft?: FoodDraft | null }>();
const open = defineModel<boolean>('open', { default: false });

const actions = useActions();

const name = ref('');
const category = ref('');
const kcal = ref(0);
const protein = ref(0);
const fat = ref(0);
const carbs = ref(0);
const pieceGrams = ref<number | undefined>(undefined);
const barcode = ref<string | undefined>(undefined);

watch(open, (value) => {
  if (!value) return;
  name.value = food?.name ?? draft?.name ?? '';
  category.value = food?.category ?? draft?.category ?? 'Прочее';
  kcal.value = food?.kcal ?? draft?.kcal ?? 0;
  protein.value = food?.protein ?? draft?.protein ?? 0;
  fat.value = food?.fat ?? draft?.fat ?? 0;
  carbs.value = food?.carbs ?? draft?.carbs ?? 0;
  pieceGrams.value = food?.pieceGrams ?? draft?.pieceGrams;
  barcode.value = food?.barcode ?? draft?.barcode;
}, { immediate: true });

function save(): void {
  if (name.value.trim() === '') return;
  const now = Date.now();
  actions.upsertFood({
    id: food?.id ?? crypto.randomUUID(),
    name: name.value.trim(),
    category: category.value.trim() === '' ? 'Прочее' : category.value.trim(),
    kcal: Math.max(0, kcal.value),
    protein: Math.max(0, protein.value),
    fat: Math.max(0, fat.value),
    carbs: Math.max(0, carbs.value),
    ...(pieceGrams.value !== undefined && pieceGrams.value > 0 && { pieceGrams: pieceGrams.value }),
    // Штрихкод переживает правку карточки: по нему повторное сканирование
    // находит этот продукт, а не заводит двойника.
    ...(barcode.value !== undefined && barcode.value !== '' && { barcode: barcode.value }),
    usedCount: food?.usedCount ?? 0,
    lastUsedAt: food?.lastUsedAt ?? 0,
    createdAt: food?.createdAt ?? now,
  });
  open.value = false;
}
</script>

<template>
  <Sheet
    v-model:open="open"
    :title="food === null ? 'Новый продукт' : 'Продукт'"
    description="Значения на 100 грамм"
  >
    <div class="grid grid-cols-2 gap-3">
      <div class="col-span-2">
        <TextField v-model="name" label="Название" required />
      </div>
      <div class="col-span-2">
        <TextField v-model="category" label="Категория" />
      </div>
      <TextField v-model.number="kcal" label="Ккал" type="number" inputmode="numeric" />
      <TextField v-model.number="protein" label="Белки, г" type="number" inputmode="decimal" />
      <TextField v-model.number="fat" label="Жиры, г" type="number" inputmode="decimal" />
      <TextField v-model.number="carbs" label="Углеводы, г" type="number" inputmode="decimal" />
      <div class="col-span-2">
        <TextField
          v-model.number="pieceGrams"
          label="Вес штуки, г"
          type="number"
          inputmode="numeric"
          hint="Включает ввод порции в штуках — для яиц, хлебцев, батончиков"
        />
      </div>
      <p v-if="barcode !== undefined" class="tnum col-span-2 text-xs text-text-faint">
        Штрихкод: {{ barcode }}
      </p>
    </div>

    <template #footer>
      <div class="flex gap-2">
        <Button
          v-if="food !== null && food.builtin !== true"
          tone="danger"
          @click="actions.removeFood(food.id); open = false"
        >
          Удалить
        </Button>
        <Button tone="primary" block :disabled="name.trim() === ''" @click="save">
          Сохранить
        </Button>
      </div>
    </template>
  </Sheet>
</template>
