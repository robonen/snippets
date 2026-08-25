<script setup lang="ts">
import { ref, watch } from 'vue';
import { Button, NumberField, Sheet, TextField } from '@brain/ui';
import { CATEGORY_COLORS, COLOR_LABELS, colorOf, suggestColor } from '../../entities/category';
import type { Category, CategoryColor } from '../../entities/category';
import { toKopecks, toRubles } from '../../lib/money';
import { newId } from '../../lib/id';

/**
 * Форма категории: имя, цвет и месячный лимит.
 *
 * Лимит живёт здесь, а не отдельным экраном бюджетов: бюджет — это свойство
 * категории, и разводить их по разным местам значило бы заводить категорию
 * дважды. Пустое поле — бюджета нет; ноль означал бы, что любая трата по
 * категории сразу перерасход.
 */

/**
 * Шаг лимита — пятьсот рублей: бюджеты назначают круглыми, и кнопки должны
 * попадать в те же круглые числа.
 */
const STEP = 500;

const { category, categories } = defineProps<{
  category?: Category;
  /** Уже заведённые категории — из них выбирается непохожий цвет для новой. */
  categories: readonly Category[];
}>();

const emit = defineEmits<{ save: [category: Category] }>();

const open = defineModel<boolean>('open', { default: false });

const name = ref('');
const colorKey = ref<CategoryColor>('teal');
const limit = ref<number | null>(null);

watch(open, (isOpen) => {
  if (!isOpen) return;
  name.value = category?.name ?? '';
  colorKey.value = category?.colorKey ?? suggestColor(categories);
  limit.value = category?.limit === undefined ? null : toRubles(category.limit);
});

function submit(): void {
  const trimmed = name.value.trim();
  if (trimmed === '') return;

  const draft: Category = {
    id: category?.id ?? newId(),
    name: trimmed,
    colorKey: colorKey.value,
  };
  const kopecks = toKopecks(limit.value);
  if (kopecks !== null && kopecks > 0) draft.limit = kopecks;

  emit('save', draft);
  open.value = false;
}
</script>

<template>
  <Sheet v-model:open="open" :title="category ? 'Правка категории' : 'Новая категория'">
    <form class="flex flex-col gap-3.5" @submit.prevent="submit">
      <TextField v-model="name" label="Название" placeholder="Продукты" required />

      <!-- Свотчи, а не список: цвет выбирают глазом, и подпись «бирюзовый»
           рядом с образцом ничего не добавляет зрячему. Имя цвета уходит в
           `aria-label` — тому, кто образца не видит. -->
      <div role="group" aria-label="Цвет" class="flex flex-col gap-1.5">
        <span aria-hidden="true" class="text-[0.8125rem] font-medium text-text-soft">Цвет</span>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="color in CATEGORY_COLORS"
            :key="color"
            type="button"
            :aria-label="COLOR_LABELS[color]"
            :aria-pressed="colorKey === color"
            class="grid size-8 place-items-center rounded-full border-2 transition-colors"
            :class="colorKey === color ? 'border-text' : 'border-transparent hover:border-line-strong'"
            @click="colorKey = color"
          >
            <span class="size-5 rounded-full" :style="{ background: colorOf(color) }" />
          </button>
        </div>
      </div>

      <NumberField
        v-model="limit"
        label="Месячный лимит"
        unit="₽"
        :min="0"
        :step="STEP"
        placeholder="не задан"
        hint="Пусто — бюджета нет. С лимитом в сводке появится полоса и предупреждение о перерасходе."
      />

      <button type="submit" class="sr-only" tabindex="-1">Сохранить</button>
    </form>

    <template #footer>
      <Button tone="primary" block :disabled="name.trim() === ''" @click="submit">
        {{ category ? 'Сохранить' : 'Добавить' }}
      </Button>
    </template>
  </Sheet>
</template>
