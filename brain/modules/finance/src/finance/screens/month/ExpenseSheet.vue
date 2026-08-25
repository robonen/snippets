<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { Button, NumberField, Select, Sheet, TextField } from '@brain/ui';
import type { SelectOption } from '@brain/ui';
import { todayISO } from '@brain/std';
import type { Category } from '../../entities/category';
import type { Expense } from '../../entities/expense';
import { occurrenceDate } from '../../entities/recurring';
import { toKopecks, toRubles } from '../../lib/money';
import { newId } from '../../lib/id';

/**
 * Лист траты: добавление и правка.
 *
 * Одна форма на оба случая: разница только в том, откуда взялись начальные
 * значения и чей id уедет в хранилище, а поля и проверки одни и те же — вторая
 * форма означала бы две расходящиеся копии этих проверок.
 *
 * Сумма вводится ЧИСЛОВЫМ полем, а не строкой: строка живёт в быстром вводе,
 * где вместе с суммой набирают описание, а здесь поле у суммы своё — и от него
 * нужны шаг, границы и `role="spinbutton"`, которых у текстового нет.
 */

/**
 * Метка «без категории» для списка. Пустая строка примитивом запрещена — она
 * неотличима от «не выбрано», — а с настоящим id категории не столкнётся: они
 * UUID.
 */
const NONE = 'none';

/**
 * Шаг кнопок: полсотни рублей. Единица делала бы их бесполезными (сумму
 * набирают с клавиатуры), сотня — слишком грубой для правки.
 */
const STEP = 50;

const { expense, categories, month } = defineProps<{
  expense?: Expense;
  categories: readonly Category[];
  /** Открытый месяц: новая трата ложится в него, а не в календарное «сегодня». */
  month: string;
}>();

const emit = defineEmits<{
  save: [expense: Expense];
  remove: [expense: Expense];
}>();

const open = defineModel<boolean>('open', { default: false });

const dateId = useId();

const amount = ref<number | null>(null);
const note = ref('');
const category = ref<string>(NONE);
const date = ref(todayISO());

const options = computed<SelectOption[]>(() => [
  { value: NONE, label: 'Без категории' },
  ...categories.map(item => ({ value: item.id, label: item.name })),
]);

// Начальные значения ставятся на ОТКРЫТИИ, а не на смене пропа: лист живёт в
// дереве постоянно, и сброс по `expense` затирал бы наполовину введённую сумму.
watch(open, (isOpen) => {
  if (!isOpen) return;
  amount.value = expense === undefined ? null : toRubles(expense.amount);
  note.value = expense?.note ?? '';
  category.value = expense?.category ?? NONE;
  date.value = expense?.date ?? defaultDate();
});

const kopecks = computed(() => toKopecks(amount.value));
const error = computed(() => {
  if (amount.value === null) return undefined;
  if (kopecks.value === null) return 'Не похоже на сумму';
  // Ноль — не трата: такая запись ничего не меняет ни в дне, ни в сводке.
  return kopecks.value <= 0 ? 'Сумма должна быть больше нуля' : undefined;
});
const valid = computed(() => kopecks.value !== null && kopecks.value > 0 && date.value !== '');

/**
 * День по умолчанию — сегодняшний, но только в текущем месяце. В открытом
 * прошлом месяце «сегодня» уехало бы в чужой месяц, и запись пропала бы из
 * виду сразу после сохранения.
 */
function defaultDate(): string {
  const today = todayISO();
  return today.startsWith(month) ? today : occurrenceDate(month, 1);
}

function submit(): void {
  const value = kopecks.value;
  if (value === null || value <= 0 || date.value === '') return;

  const draft: Expense = {
    id: expense?.id ?? newId(),
    amount: value,
    date: date.value,
    // Правка сохраняет исходную метку: трата не «записана заново» оттого, что
    // ей поправили сумму. Ссылка на подписку тоже переживает правку — иначе
    // подстановка предложила бы записать тот же месяц второй раз.
    createdAt: expense?.createdAt ?? Date.now(),
    ...(expense?.recurring !== undefined && { recurring: expense.recurring }),
  };
  if (category.value !== NONE) draft.category = category.value;
  const text = note.value.trim();
  if (text !== '') draft.note = text;

  emit('save', draft);
  open.value = false;
}

// Лист закрывается ДО того, как поднимется подтверждение: два наложенных
// диалога спорят за фокус, и закрывающийся забирает его себе последним.
function remove(): void {
  if (expense === undefined) return;
  open.value = false;
  emit('remove', expense);
}
</script>

<template>
  <Sheet v-model:open="open" :title="expense ? 'Правка траты' : 'Новая трата'">
    <form class="flex flex-col gap-3.5" @submit.prevent="submit">
      <NumberField
        v-model="amount"
        label="Сумма"
        unit="₽"
        :min="0"
        :step="STEP"
        placeholder="1250,50"
        :error="error"
        hint="Рубли и копейки — через запятую."
      />

      <TextField v-model="note" label="Описание" placeholder="кофе" />

      <Select
        v-model="category"
        label="Категория"
        :options="options"
        placeholder="Без категории"
      />

      <div class="flex flex-col gap-1.5">
        <label :for="dateId" class="text-[0.8125rem] font-medium text-text-soft">День</label>
        <input
          :id="dateId"
          v-model="date"
          type="date"
          required
          class="h-10 w-full rounded-control border border-line bg-surface px-3 text-sm text-text
                 transition-colors hover:border-line-strong"
        >
      </div>

      <!-- Скрытая кнопка: Enter в поле обязан отправлять форму, а видимая
           кнопка отправки живёт в подвале листа, вне <form>. -->
      <button type="submit" class="sr-only" tabindex="-1">Сохранить</button>
    </form>

    <template #footer>
      <div class="flex items-center gap-2">
        <Button v-if="expense" tone="danger" @click="remove">
          Удалить
        </Button>
        <Button tone="primary" block :disabled="!valid" @click="submit">
          {{ expense ? 'Сохранить' : 'Записать' }}
        </Button>
      </div>
    </template>
  </Sheet>
</template>
