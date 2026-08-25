<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { Plus } from 'lucide-vue-next';
import { Button, ConfirmDialog, Page, PageHeader, Tabs, useToast } from '@brain/ui';
import type { Tab } from '@brain/ui';
import { todayISO } from '@brain/std';
import type { Expense } from '../../entities/expense';
import { useActions, useCategories } from '../../db/composables';
import { currentMonth } from '../../lib/month';
import { formatMoney } from '../../lib/money';
import { parseQuickEntry } from '../../lib/quick';
import { onEntryRequested } from '../../lib/intent';
import { newId } from '../../lib/id';
import CategoriesPanel from '../categories/CategoriesPanel.vue';
import YearPanel from '../year/YearPanel.vue';
import MonthPanel from './MonthPanel.vue';
import ExpenseSheet from './ExpenseSheet.vue';

/**
 * Финансы: месяц, справочники и год — тремя вкладками.
 *
 * Быстрый ввод стоит НАД вкладками, а не внутри месяца: это главный вход
 * модуля, и прятать его за переключателем значило бы, что запись траты начинается
 * с навигации. Открытый месяц — состояние экрана, а не адрес: месяц листают, а
 * не пересылают, и параметр маршрута писал бы историю на каждое нажатие стрелки.
 *
 * Лист траты и подтверждение удаления живут здесь, а не в панели месяца: их
 * зовёт ещё и команда палитры, а панель невидимой вкладки размонтирована и до
 * сигнала не доживёт.
 */
type Section = 'month' | 'categories' | 'year';

const categories = useCategories();
const actions = useActions();
const toast = useToast();

const section = shallowRef<Section>('month');
const month = shallowRef(currentMonth());

const quick = ref('');
const draft = computed(() => parseQuickEntry(quick.value));
const preview = computed(() => {
  if (quick.value.trim() === '') return 'Например: 250 кофе или 1250,50 продукты.';
  if (draft.value === null) return 'Строка начинается с суммы: «250 кофе».';
  return draft.value.note === ''
    ? formatMoney(draft.value.amount)
    : `${formatMoney(draft.value.amount)} · ${draft.value.note}`;
});

const sheet = shallowRef(false);
const editing = shallowRef<Expense | undefined>();

const removing = shallowRef<Expense | undefined>();
const confirming = shallowRef(false);

const TABS: Array<Tab<Section>> = [
  { value: 'month', label: 'Месяц' },
  { value: 'categories', label: 'Категории' },
  { value: 'year', label: 'Год' },
];

/**
 * Год — сводка с графиком, и ширина ему идёт на пользу: на 84 rem бенто встаёт
 * двумя ровными строками, а двенадцать столбиков перестают лепиться друг к
 * другу. Месяц и справочники остаются списками: строке траты лишняя ширина
 * ничего не добавляет, кроме расстояния от названия до суммы.
 */
onEntryRequested(() => {
  editing.value = undefined;
  sheet.value = true;
});

function addQuick(): void {
  const parsed = draft.value;
  if (parsed === null) return;

  const today = todayISO();
  const expense: Expense = { id: newId(), amount: parsed.amount, date: today, createdAt: Date.now() };
  if (parsed.note !== '') expense.note = parsed.note;
  actions.saveExpense(expense);

  quick.value = '';
  // Трата пишется на СЕГОДНЯ, поэтому открытый месяц переводим на текущий:
  // иначе запись уезжает из виду, и её вводят второй раз.
  month.value = currentMonth(today);
  section.value = 'month';
}

function add(): void {
  editing.value = undefined;
  sheet.value = true;
}

function edit(expense: Expense): void {
  editing.value = expense;
  sheet.value = true;
}

function askRemove(expense: Expense): void {
  removing.value = expense;
  confirming.value = true;
}

// Удаление подтверждается диалогом И остаётся отменяемым: подтверждение ловит
// промах пальцем, «Отменить» — передумавшего. Снимок траты уже на руках,
// поэтому возврат — обычная запись под тем же id.
function confirmRemove(): void {
  const expense = removing.value;
  if (expense === undefined) return;

  actions.removeExpense(expense.id);
  removing.value = undefined;
  toast.show({
    title: 'Трата удалена',
    description: `${formatMoney(expense.amount)}${expense.note === undefined ? '' : ` · ${expense.note}`}`,
    action: {
      label: 'Отменить',
      altText: 'Восстановить удалённую трату',
      onAction: () => actions.saveExpense(expense),
    },
  });
}

/** Из годового обзора — в конкретный месяц: столбик графика это и обещает. */
function openMonth(value: string): void {
  month.value = value;
  section.value = 'month';
}
</script>

<template>
  <Page width="list">
    <div class="flex flex-col gap-4">
      <PageHeader title="Финансы">
        <template #action>
          <Button tone="primary" size="sm" @click="add">
            <Plus class="size-4" />
            Трата
          </Button>
        </template>
      </PageHeader>

      <!-- Быстрый ввод набран крупно намеренно: это главный вход модуля, и поле
           размером с обычную настройку выглядело бы как одна из них. Ширину поле
           всё же ограничивает: строка «250 кофе» короткая, и растянутое на всю
           сводку оно читается как поиск по сайту, а не как ввод суммы. -->
      <form class="flex max-w-2xl flex-col gap-1.5" @submit.prevent="addQuick">
        <div class="flex gap-2">
          <input
            v-model="quick"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            placeholder="250 кофе"
            aria-label="Быстрый ввод траты"
            aria-describedby="finance-quick-preview"
            class="h-12 min-w-0 flex-1 rounded-control border border-line bg-surface px-4 text-base text-text
                   transition-colors placeholder:text-text-faint focus:border-accent focus:outline-none"
          >
          <Button type="submit" tone="primary" size="lg" :disabled="draft === null">
            Записать
          </Button>
        </div>
        <!-- Разбор строки показывается живой областью, а не подсказкой поля:
             `aria-describedby` читается один раз при фокусе, а здесь текст меняется
             на каждом символе — и «сколько именно запишется» надо услышать
             ДО нажатия, а не после. -->
        <p id="finance-quick-preview" aria-live="polite" class="px-0.5 text-xs text-text-faint">{{ preview }}</p>
      </form>

      <Tabs v-model="section" :items="TABS" label="Разделы финансов">
        <template #month>
          <MonthPanel v-model:month="month" @edit="edit" @remove="askRemove" />
        </template>

        <template #categories>
          <CategoriesPanel :month="month" />
        </template>

        <template #year>
          <YearPanel :month="month" @open-month="openMonth" />
        </template>
      </Tabs>
    </div>

    <ExpenseSheet
      v-model:open="sheet"
      :expense="editing"
      :categories="categories"
      :month="month"
      @save="actions.saveExpense"
      @remove="askRemove"
    />

    <ConfirmDialog
      v-model:open="confirming"
      :title="`Удалить трату на ${formatMoney(removing?.amount ?? 0)}?`"
      description="Запись исчезнет из месяца и из сводки. Сразу после удаления её можно вернуть кнопкой «Отменить»."
      @confirm="confirmRemove"
    />
  </Page>
</template>
