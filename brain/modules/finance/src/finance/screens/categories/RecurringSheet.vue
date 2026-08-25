<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Button, NumberField, Select, Sheet, SwitchField, TextField } from '@brain/ui';
import type { SelectOption } from '@brain/ui';
import type { Category } from '../../entities/category';
import { MAX_DAY, MIN_DAY, occurrenceDate } from '../../entities/recurring';
import type { Recurring } from '../../entities/recurring';
import { monthTitle, shiftMonth } from '../../lib/month';
import { formatMoney, toKopecks, toRubles } from '../../lib/money';
import { newId } from '../../lib/id';

/**
 * Форма повторяющейся траты: что списывается, сколько и какого числа.
 *
 * Расписание одно — «каждый месяц N-го». Подсказка под днём показывает, во что
 * это превратится в ближайшем месяце: «31-е» в феврале станет 28-м, и увидеть
 * это надо до сохранения, а не через месяц в списке.
 */

/** Шаг суммы — полсотни рублей, как и в трате: подписки правят, а не набирают. */
const STEP = 50;

/** Метка «без категории»: пустая строка примитивом запрещена. */
const NONE = 'none';

const { rule, categories, month } = defineProps<{
  rule?: Recurring;
  categories: readonly Category[];
  /** Открытый месяц — на нём показывается пример дня списания. */
  month: string;
}>();

const emit = defineEmits<{ save: [rule: Recurring] }>();

const open = defineModel<boolean>('open', { default: false });

const title = ref('');
const amount = ref<number | null>(null);
const category = ref<string>(NONE);
const day = ref<number | null>(1);
const active = ref(true);

const options = computed<SelectOption[]>(() => [
  { value: NONE, label: 'Без категории' },
  ...categories.map(item => ({ value: item.id, label: item.name })),
]);

watch(open, (isOpen) => {
  if (!isOpen) return;
  title.value = rule?.title ?? '';
  amount.value = rule === undefined ? null : toRubles(rule.amount);
  category.value = rule?.category ?? NONE;
  day.value = rule?.day ?? 1;
  active.value = rule?.active ?? true;
});

const kopecks = computed(() => toKopecks(amount.value));
const valid = computed(() =>
  title.value.trim() !== '' && kopecks.value !== null && kopecks.value > 0 && day.value !== null);

/** Во что превратится «N-го» в этом месяце и в следующем — февраль виден сразу. */
const preview = computed(() => {
  if (day.value === null) return 'Выберите число месяца.';
  const next = shiftMonth(month, 1);
  return `${occurrenceDate(month, day.value)} · ${occurrenceDate(next, day.value)} (${monthTitle(next)})`;
});

function submit(): void {
  const value = kopecks.value;
  if (value === null || value <= 0 || day.value === null) return;

  const draft: Recurring = {
    id: rule?.id ?? newId(),
    title: title.value.trim(),
    amount: value,
    day: Math.min(Math.max(Math.trunc(day.value), MIN_DAY), MAX_DAY),
    active: active.value,
    // Правка сохраняет исходную метку: правило не «заведено заново» оттого, что
    // подписка подорожала.
    createdAt: rule?.createdAt ?? Date.now(),
  };
  if (category.value !== NONE) draft.category = category.value;

  emit('save', draft);
  open.value = false;
}
</script>

<template>
  <Sheet
    v-model:open="open"
    :title="rule ? 'Правка повторяющейся траты' : 'Новая повторяющаяся трата'"
    :description="kopecks === null ? undefined : `${formatMoney(kopecks)} каждый месяц`"
  >
    <form class="flex flex-col gap-3.5" @submit.prevent="submit">
      <TextField v-model="title" label="Что списывается" placeholder="Подписка на музыку" required />

      <NumberField
        v-model="amount"
        label="Сумма"
        unit="₽"
        :min="0"
        :step="STEP"
        placeholder="299"
      />

      <Select v-model="category" label="Категория" :options="options" placeholder="Без категории" />

      <NumberField
        v-model="day"
        label="Число месяца"
        :min="MIN_DAY"
        :max="MAX_DAY"
        :hint="preview"
      />

      <SwitchField
        v-model="active"
        label="Подставлять в месяц"
        description="Выключенное правило ничего не записывает, но помнит сумму и день."
      />

      <button type="submit" class="sr-only" tabindex="-1">Сохранить</button>
    </form>

    <template #footer>
      <Button tone="primary" block :disabled="!valid" @click="submit">
        {{ rule ? 'Сохранить' : 'Добавить' }}
      </Button>
    </template>
  </Sheet>
</template>
