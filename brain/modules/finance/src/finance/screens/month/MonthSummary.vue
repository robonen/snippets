<script setup lang="ts">
import { computed } from 'vue';
import { Meter } from '@brain/ui';
import { budgetStatus } from '../../entities/budget';
import { colorById, nameById } from '../../entities/category';
import type { Category } from '../../entities/category';
import { shareOf, sumAmount, sumByCategory } from '../../entities/expense';
import type { Expense } from '../../entities/expense';
import { formatMoney } from '../../lib/money';

/**
 * Разбивка месяца по категориям — полосами долей.
 *
 * Итог месяца здесь НЕ повторяется: он стоит опорой наверху вкладки, и второе
 * такое же число рядом отнимало бы у него вес вместо того, чтобы что-то
 * добавить.
 *
 * Доли считаются от итога МЕСЯЦА, а не от суммы показанных строк: обрезка
 * длинного хвоста не имеет права раздувать проценты у верхних категорий —
 * иначе сводка перестаёт сходиться с итогом, который стоит прямо над ней.
 */
const { expenses, categories } = defineProps<{
  expenses: readonly Expense[];
  categories: ReadonlyMap<string, Category>;
}>();

/** Длинный хвост мелких категорий не помещается и ничего не объясняет. */
const LIMIT = 6;

const total = computed(() => sumAmount(expenses));
const sums = computed(() => sumByCategory(expenses));

const rows = computed(() => sums.value.slice(0, LIMIT).map((row) => {
  const category = row.category === undefined ? undefined : categories.get(row.category);
  const status = budgetStatus(row.total, category?.limit);
  const percent = Math.round(shareOf(row.total, total.value) * 100);
  return {
    key: row.category ?? 'none',
    label: nameById(categories, row.category) ?? 'Без категории',
    // Перерасход перекрашивает полосу и называется словом: цвет находит строку
    // взглядом, но сообщать смысл одним цветом нельзя.
    color: status.state === 'over' ? 'var(--danger)' : colorById(categories, row.category),
    caption: status.state === 'over'
      ? `${formatMoney(row.total)} · перерасход`
      : `${formatMoney(row.total)} · ${percent}%`,
    total: row.total,
  };
}));

const hidden = computed(() => Math.max(sums.value.length - LIMIT, 0));
</script>

<template>
  <section class="rounded-card border border-line bg-surface p-4">
    <h2 class="mb-3 text-xs font-medium tracking-wide text-text-faint uppercase">По категориям</h2>

    <div class="flex flex-col gap-2.5">
      <Meter
        v-for="row in rows"
        :key="row.key"
        :value="row.total"
        :max="total"
        :label="row.label"
        :caption="row.caption"
        :color="row.color"
      />
    </div>

    <p v-if="hidden > 0" class="mt-3 text-xs text-text-faint">
      {{ `и ещё категорий: ${hidden}` }}
    </p>
  </section>
</template>
