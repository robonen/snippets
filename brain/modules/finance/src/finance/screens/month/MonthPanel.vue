<script setup lang="ts">
import { computed } from 'vue';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { Badge, Button, EmptyState, Meter, StatTile, useToast } from '@brain/ui';
import { dayTitle } from '@brain/std';
import { budgetRows, overBudgetCount } from '../../entities/budget';
import type { BudgetRow } from '../../entities/budget';
import { byId, colorById, colorOf, nameById } from '../../entities/category';
import type { Category } from '../../entities/category';
import { groupByDay, inMonth, sumAmount, sumByCategory } from '../../entities/expense';
import type { Expense } from '../../entities/expense';
import { draftFromRule, dueRules } from '../../entities/recurring';
import type { Recurring } from '../../entities/recurring';
import { compareTotals } from '../../entities/year';
import { useActions, useCategories, useExpenses, useRules } from '../../db/composables';
import { currentMonth, monthTitle, shiftMonth } from '../../lib/month';
import { formatMoney } from '../../lib/money';
import { newId } from '../../lib/id';
import MonthSummary from './MonthSummary.vue';
import ExpenseRow from './ExpenseRow.vue';

/**
 * Траты за месяц: итог, бюджеты, подписки и список по дням.
 *
 * Итог месяца — опора экрана и набран по-настоящему крупно: это единственное
 * число, ради которого вкладку открывают, и мелким оно теряется среди подписей.
 * Сравнение с прошлым месяцем стоит рядом с ним, а не в годовом обзоре: «много
 * ли это» спрашивают, глядя на текущую сумму.
 *
 * С `lg` вкладка расходится на две колонки: слева сводка (итог, бюджеты,
 * категории), справа сами траты. Друг под другом они заставляли прокручивать
 * пол-экрана сводки, чтобы добраться до списка, — а вопросы «сколько ушло» и
 * «на что именно» задают одновременно.
 */
const emit = defineEmits<{
  edit: [expense: Expense];
  remove: [expense: Expense];
}>();

const month = defineModel<string>('month', { required: true });

const expenses = useExpenses();
const categories = useCategories();
const rules = useRules();
const actions = useActions();
const toast = useToast();

const catalog = computed<ReadonlyMap<string, Category>>(() => byId(categories.value));

const monthly = computed(() => inMonth(expenses.value, month.value));
const days = computed(() => groupByDay(monthly.value));
const isCurrent = computed(() => month.value === currentMonth());

const total = computed(() => sumAmount(monthly.value));
const previous = computed(() => sumAmount(inMonth(expenses.value, shiftMonth(month.value, -1))));
const change = computed(() => compareTotals(total.value, previous.value));
const average = computed(() => (monthly.value.length === 0
  ? 0
  : Math.round(total.value / monthly.value.length)));

const budgets = computed<BudgetRow[]>(() => budgetRows(categories.value, sumByCategory(monthly.value)));
const over = computed(() => overBudgetCount(budgets.value));

const due = computed(() => dueRules(rules.value, expenses.value, month.value));

/**
 * Сравнение с прошлым месяцем под итогом.
 *
 * Пустой прошлый месяц дельты не даёт: «+100%» от нуля не сообщает ничего.
 * Тон обратный направлению — больше потратить плохо, меньше хорошо.
 */
const delta = computed(() => {
  if (previous.value === 0 || change.value.direction === 'flat') return undefined;
  const up = change.value.direction === 'up';
  const percent = change.value.share === null ? null : Math.round(Math.abs(change.value.share) * 100);
  return {
    text: `${up ? '+' : '−'}${formatMoney(Math.abs(change.value.delta))}`,
    hint: percent === null ? 'к прошлому месяцу' : `${percent}% к прошлому месяцу`,
    tone: up ? 'text-danger' : 'text-positive',
    icon: up ? ArrowUp : ArrowDown,
  };
});

function shift(step: number): void {
  month.value = shiftMonth(month.value, step);
}

function captionOf(row: BudgetRow): string {
  const { spent, limit = 0, left = 0 } = row.status;
  return left < 0
    ? `перерасход ${formatMoney(-left)}`
    : `${formatMoney(spent)} из ${formatMoney(limit)}`;
}

function subtitleOf(rule: Recurring): string {
  const name = nameById(catalog.value, rule.category);
  return name === undefined ? `${rule.day}-го числа` : `${rule.day}-го числа · ${name}`;
}

/**
 * Записать подписки в открытый месяц. Пачкой и одной транзакцией: это одно
 * решение пользователя, а не пять. Отмена снимает ровно то, что записали, —
 * поэтому id черновиков остаются на руках.
 */
function record(items: readonly Recurring[]): void {
  if (items.length === 0) return;

  const now = Date.now();
  const drafts = items.map(rule => draftFromRule(rule, month.value, newId(), now));
  actions.saveExpenses(drafts);

  toast.show({
    title: drafts.length === 1 ? 'Подписка записана' : `Записано трат: ${drafts.length}`,
    description: formatMoney(sumAmount(drafts)),
    action: {
      label: 'Отменить',
      altText: 'Убрать записанные подписки',
      onAction: () => {
        for (const draft of drafts) actions.removeExpense(draft.id);
      },
    },
  });
}
</script>

<template>
  <div class="grid gap-3 lg:grid-cols-2 lg:items-start">
    <div class="flex flex-col gap-3">
      <!-- Опора вкладки: месяц, сумма и дельта одной поверхностью. -->
      <section class="rounded-card border border-line bg-surface px-5 pt-2 pb-5">
        <header class="-mx-3 flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label="Предыдущий месяц"
            class="pressable grid size-10 place-items-center rounded-control text-text-faint hoverable
                   hover:text-text"
            @click="shift(-1)"
          >
            <ChevronLeft class="size-5" />
          </button>

          <div class="text-center">
            <h2 class="text-xs font-medium tracking-wide text-text-faint uppercase">{{ monthTitle(month) }}</h2>
            <button
              v-if="!isCurrent"
              type="button"
              class="text-xs text-accent hover:underline"
              @click="month = currentMonth()"
            >
              вернуться к текущему
            </button>
          </div>

          <button
            type="button"
            aria-label="Следующий месяц"
            class="pressable grid size-10 place-items-center rounded-control text-text-faint hoverable
                   hover:text-text"
            @click="shift(1)"
          >
            <ChevronRight class="size-5" />
          </button>
        </header>

        <!-- Кегль в `clamp`: «125 250,50 ₽» — тринадцать знаков широким гротеском,
             и фиксированные 3,5 rem на телефоне дали бы горизонтальную прокрутку. -->
        <p class="text-display mt-2 text-center text-[clamp(2rem,9.5vw,3.5rem)] leading-none text-text">
          {{ formatMoney(total) }}
        </p>

        <p v-if="delta !== undefined" class="mt-2.5 flex items-center justify-center gap-1.5 text-xs">
          <span class="tnum flex items-center gap-1" :class="delta.tone">
            <component :is="delta.icon" class="size-3.5" />
            {{ delta.text }}
          </span>
          <span class="tnum text-text-faint">{{ delta.hint }}</span>
        </p>
        <p v-else class="mt-2.5 text-center text-xs text-text-faint">
          {{ monthly.length === 0 ? 'ни одной траты' : 'сравнивать не с чем: прошлый месяц пуст' }}
        </p>
      </section>

      <section v-if="monthly.length > 0" class="grid grid-cols-2 gap-3">
        <StatTile :value="String(monthly.length)" label="записей за месяц" />
        <StatTile :value="formatMoney(average)" label="средняя трата" />
      </section>

      <section v-if="due.length > 0" class="overflow-hidden rounded-card border border-line bg-surface">
        <header class="flex items-center gap-2 px-4 pt-3.5 pb-2">
          <h2 class="text-xs font-medium tracking-wide text-text-faint uppercase">Пора записать</h2>
          <Button v-if="due.length > 1" size="sm" class="ml-auto" @click="record(due)">
            Записать все
          </Button>
        </header>

        <ul class="divide-y divide-line border-t border-line">
          <li v-for="rule in due" :key="rule.id" class="flex items-center gap-3 px-4 py-2.5">
            <span
              aria-hidden="true"
              class="size-2 shrink-0 rounded-full"
              :style="{ background: colorById(catalog, rule.category) }"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm text-text">{{ rule.title }}</span>
              <span class="block truncate text-xs text-text-faint">{{ subtitleOf(rule) }}</span>
            </span>
            <span class="tnum shrink-0 text-sm text-text">{{ formatMoney(rule.amount) }}</span>
            <Button size="sm" @click="record([rule])">
              Записать
            </Button>
          </li>
        </ul>
      </section>

      <section v-if="budgets.length > 0" class="rounded-card border border-line bg-surface p-4">
        <header class="mb-3 flex items-center justify-between gap-3">
          <h2 class="text-xs font-medium tracking-wide text-text-faint uppercase">Бюджеты</h2>
          <Badge v-if="over > 0" tone="danger" sr-label="категорий с перерасходом">
            {{ `перерасход: ${over}` }}
          </Badge>
        </header>

        <div class="flex flex-col gap-3">
          <Meter
            v-for="row in budgets"
            :key="row.category.id"
            :value="row.status.spent"
            :max="row.status.limit ?? 0"
            :label="row.category.name"
            :caption="captionOf(row)"
            :color="colorOf(row.category.colorKey)"
          />
        </div>
      </section>

      <MonthSummary v-if="monthly.length > 0" :expenses="monthly" :categories="catalog" />
    </div>

    <div class="min-w-0">
      <!--
        Траты — ОДНА поверхность: дни разделены секционными заголовками, а не
        обёрнуты каждый в свою карточку. Ряд карточек одного веса превращает месяц
        в решётку прямоугольников, по которой не видно, где кончился день.
      -->
      <div v-if="days.length > 0" class="overflow-hidden rounded-card border border-line bg-surface">
        <section v-for="day in days" :key="day.date" class="border-b border-line last:border-b-0">
          <header class="flex items-baseline gap-2 px-4 pt-3.5 pb-2">
            <h2 class="text-xs font-medium tracking-wide text-text-faint uppercase">{{ dayTitle(day.date) }}</h2>
            <span class="tnum ml-auto text-xs text-text-faint">{{ formatMoney(day.total) }}</span>
          </header>

          <ul class="divide-y divide-line border-t border-line">
            <ExpenseRow
              v-for="expense in day.items"
              :key="expense.id"
              :expense="expense"
              :category="expense.category === undefined ? undefined : catalog.get(expense.category)"
              @edit="emit('edit', expense)"
              @remove="emit('remove', expense)"
            />
          </ul>
        </section>
      </div>

      <EmptyState
        v-else
        title="За этот месяц трат нет"
        description="Строка быстрого ввода наверху начинается с суммы: «250 кофе» запишет трату на сегодня. Категорию и день можно поправить потом, а итог и сравнение с прошлым месяцем посчитаются сами."
      />
    </div>
  </div>
</template>
