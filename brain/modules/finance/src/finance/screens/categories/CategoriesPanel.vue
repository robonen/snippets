<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { Plus } from 'lucide-vue-next';
import { Badge, Button, ConfirmDialog, EmptyState, Menu, Meter, StatTile, useToast } from '@brain/ui';
import type { MenuAction } from '@brain/ui';
import { budgetStatus } from '../../entities/budget';
import { byId, colorOf, nameById } from '../../entities/category';
import type { Category } from '../../entities/category';
import { inMonth, sumByCategory } from '../../entities/expense';
import { monthlyLoad } from '../../entities/recurring';
import type { Recurring } from '../../entities/recurring';
import { useActions, useCategories, useExpenses, useRules } from '../../db/composables';
import { formatMoney } from '../../lib/money';
import CategorySheet from './CategorySheet.vue';
import RecurringSheet from './RecurringSheet.vue';

/**
 * Справочники модуля: категории с бюджетами и повторяющиеся траты.
 *
 * Оба списка — про НАСТРОЙКУ, а не про деньги этого месяца, поэтому и живут
 * отдельной вкладкой: править их приходят редко, а месяц открывают каждый день.
 * Суммы рядом с категорией показаны за открытый месяц — иначе «лимит 10 000»
 * висел бы без ответа на вопрос «а сколько уже».
 *
 * Доля бюджета — полосой под строкой, а не третьей колонкой цифр: полоса
 * отвечает на «сколько осталось» за один взгляд по всему списку сразу.
 *
 * Списки стоят рядом с `lg`: это два справочника одного веса, и друг под другом
 * они прятали подписки под длинным списком категорий — при том, что правят их
 * обычно за один заход.
 */
const { month } = defineProps<{ month: string }>();

const expenses = useExpenses();
const categories = useCategories();
const rules = useRules();
const actions = useActions();
const toast = useToast();

const categorySheet = shallowRef(false);
const editingCategory = shallowRef<Category | undefined>();

const ruleSheet = shallowRef(false);
const editingRule = shallowRef<Recurring | undefined>();

/** Что удаляем. Один диалог на оба списка: вопрос один, разнятся только слова. */
const pending = shallowRef<{ kind: 'category'; category: Category } | { kind: 'rule'; rule: Recurring } | undefined>();
const confirming = shallowRef(false);

const catalog = computed(() => byId(categories.value));

/** Потрачено по категориям за открытый месяц. */
const spent = computed(() => {
  const totals = new Map<string, number>();
  for (const sum of sumByCategory(inMonth(expenses.value, month))) {
    if (sum.category !== undefined) totals.set(sum.category, sum.total);
  }
  return totals;
});

const rows = computed(() => categories.value.map((category) => {
  const status = budgetStatus(spent.value.get(category.id) ?? 0, category.limit);
  return {
    category,
    status,
    // Перерасход перекрашивает полосу; словом он назван в подписи под ней.
    color: status.state === 'over' ? 'var(--danger)' : colorOf(category.colorKey),
  };
}));

const load = computed(() => monthlyLoad(rules.value));

const confirmTitle = computed(() => {
  if (pending.value === undefined) return '';
  return pending.value.kind === 'category'
    ? `Удалить категорию «${pending.value.category.name}»?`
    : `Удалить «${pending.value.rule.title}»?`;
});

const confirmText = computed(() => (pending.value?.kind === 'category'
  ? 'Траты останутся на месте — они просто перестанут быть в этой категории. Сразу после удаления всё можно вернуть кнопкой «Отменить».'
  : 'Уже записанные по правилу траты останутся: деньги ушли, и удаление подписки не переписывает историю месяца.'));

function captionOf(category: Category): string {
  const status = budgetStatus(spent.value.get(category.id) ?? 0, category.limit);
  if (status.state === 'none') return 'бюджет не задан';
  return status.left !== undefined && status.left < 0
    ? `перерасход ${formatMoney(-status.left)} из ${formatMoney(status.limit ?? 0)}`
    : `${formatMoney(status.spent)} из ${formatMoney(status.limit ?? 0)}`;
}

function ruleSubtitle(rule: Recurring): string {
  const name = nameById(catalog.value, rule.category);
  const parts = [`${rule.day}-го числа`];
  if (name !== undefined) parts.push(name);
  if (!rule.active) parts.push('выключено');
  return parts.join(' · ');
}

function categoryMenu(category: Category): MenuAction[] {
  return [
    { id: 'edit', title: 'Править', onSelect: () => editCategory(category) },
    { id: 'remove', title: 'Удалить', danger: true, onSelect: () => ask({ kind: 'category', category }) },
  ];
}

function ruleMenu(rule: Recurring): MenuAction[] {
  return [
    { id: 'edit', title: 'Править', onSelect: () => editRule(rule) },
    {
      id: 'toggle',
      title: rule.active ? 'Выключить' : 'Включить',
      onSelect: () => actions.saveRule({ ...rule, active: !rule.active }),
    },
    { id: 'remove', title: 'Удалить', danger: true, onSelect: () => ask({ kind: 'rule', rule }) },
  ];
}

function editCategory(category?: Category): void {
  editingCategory.value = category;
  categorySheet.value = true;
}

function editRule(rule?: Recurring): void {
  editingRule.value = rule;
  ruleSheet.value = true;
}

function ask(what: NonNullable<typeof pending.value>): void {
  pending.value = what;
  confirming.value = true;
}

/**
 * Удаление подтверждается диалогом И остаётся отменяемым. У категории отмена
 * возвращает не только её саму: `removeCategory` отдаёт список отцепленных
 * трат и правил, и без них «Отменить» вернуло бы имя без принадлежности.
 */
function confirmRemove(): void {
  const what = pending.value;
  if (what === undefined) return;
  pending.value = undefined;

  if (what.kind === 'category') {
    const removal = actions.removeCategory(what.category.id);
    toast.show({
      title: 'Категория удалена',
      description: removal.expenses.length === 0
        ? what.category.name
        : `${what.category.name} · трат без категории: ${removal.expenses.length}`,
      action: {
        label: 'Отменить',
        altText: 'Вернуть категорию и её траты',
        onAction: () => actions.restoreCategory(what.category, removal),
      },
    });
    return;
  }

  actions.removeRule(what.rule.id);
  toast.show({
    title: 'Повторяющаяся трата удалена',
    description: what.rule.title,
    action: {
      label: 'Отменить',
      altText: 'Вернуть повторяющуюся трату',
      onAction: () => actions.saveRule(what.rule),
    },
  });
}
</script>

<template>
  <div class="grid gap-3 lg:grid-cols-2 lg:items-start">
    <section class="overflow-hidden rounded-card border border-line bg-surface">
      <header class="flex items-center gap-2 px-4 pt-3.5 pb-2">
        <h2 class="text-xs font-medium tracking-wide text-text-faint uppercase">Категории</h2>
        <Button size="sm" class="ml-auto" @click="editCategory()">
          <Plus class="size-4" />
          Категория
        </Button>
      </header>

      <ul v-if="rows.length > 0" class="divide-y divide-line border-t border-line">
        <li v-for="row in rows" :key="row.category.id" class="px-2 py-1">
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="pressable flex min-w-0 flex-1 items-center gap-3 rounded-control px-2 py-2 text-left
                     hoverable"
              @click="editCategory(row.category)"
            >
              <span
                aria-hidden="true"
                class="size-2 shrink-0 rounded-full"
                :style="{ background: colorOf(row.category.colorKey) }"
              />
              <span class="min-w-0 flex-1 truncate text-sm text-text">{{ row.category.name }}</span>
              <span class="tnum shrink-0 text-sm text-text">
                {{ formatMoney(spent.get(row.category.id) ?? 0) }}
              </span>
            </button>

            <Menu :items="categoryMenu(row.category)" :label="`Действия: ${row.category.name}`" />
          </div>

          <Meter
            v-if="row.status.state !== 'none'"
            class="px-2 pb-1.5"
            :value="row.status.spent"
            :max="row.status.limit ?? 0"
            :caption="captionOf(row.category)"
            :color="row.color"
          />
          <p v-else class="px-2 pb-1.5 text-xs text-text-faint">бюджет не задан</p>
        </li>
      </ul>

      <div v-else class="px-4 pb-4">
        <EmptyState
          title="Категорий пока нет"
          description="Категория нужна, чтобы месяц разложился на «продукты», «дорогу» и «всё остальное». Лимит по ней — необязателен: без него категория просто считает сумму."
        >
          <template #action>
            <Button tone="primary" @click="editCategory()">
              <Plus class="size-4" />
              Категория
            </Button>
          </template>
        </EmptyState>
      </div>
    </section>

    <div class="flex flex-col gap-3">
      <StatTile
        v-if="rules.length > 0"
        :value="formatMoney(load)"
        label="уходит каждый месяц по подпискам"
      />

      <section class="overflow-hidden rounded-card border border-line bg-surface">
        <header class="flex items-center gap-2 px-4 pt-3.5 pb-2">
          <h2 class="text-xs font-medium tracking-wide text-text-faint uppercase">Повторяющиеся траты</h2>
          <Button size="sm" class="ml-auto" @click="editRule()">
            <Plus class="size-4" />
            Подписка
          </Button>
        </header>

        <ul v-if="rules.length > 0" class="divide-y divide-line border-t border-line">
          <li v-for="item in rules" :key="item.id" class="flex items-center gap-1 pr-2">
            <button
              type="button"
              class="pressable flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-4 text-left hoverable"
              :class="!item.active && 'opacity-60'"
              @click="editRule(item)"
            >
              <span
                aria-hidden="true"
                class="tnum grid size-7 shrink-0 place-items-center rounded-control bg-sunken text-xs
                       font-medium text-text-soft"
              >
                {{ item.day }}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm text-text">{{ item.title }}</span>
                <span class="block truncate text-xs text-text-faint">{{ ruleSubtitle(item) }}</span>
              </span>
              <span class="tnum shrink-0 text-sm text-text">{{ formatMoney(item.amount) }}</span>
            </button>

            <Badge v-if="!item.active">выкл</Badge>
            <Menu :items="ruleMenu(item)" :label="`Действия: ${item.title}`" />
          </li>
        </ul>

        <div v-else class="px-4 pb-4">
          <EmptyState
            title="Подписок пока нет"
            description="Правило «каждый месяц N-го» подставит трату в открытый месяц одним нажатием — и не запишет её дважды."
          >
            <template #action>
              <Button tone="primary" @click="editRule()">
                <Plus class="size-4" />
                Подписка
              </Button>
            </template>
          </EmptyState>
        </div>
      </section>
    </div>

    <CategorySheet
      v-model:open="categorySheet"
      :category="editingCategory"
      :categories="categories"
      @save="actions.saveCategory"
    />

    <RecurringSheet
      v-model:open="ruleSheet"
      :rule="editingRule"
      :categories="categories"
      :month="month"
      @save="actions.saveRule"
    />

    <ConfirmDialog
      v-model:open="confirming"
      :title="confirmTitle"
      :description="confirmText"
      @confirm="confirmRemove"
    />
  </div>
</template>
