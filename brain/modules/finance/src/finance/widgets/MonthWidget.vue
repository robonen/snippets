<script setup lang="ts">
import { computed } from 'vue';
import { byId, colorById, nameById } from '../entities/category';
import { inMonth, sumAmount, sumByCategory } from '../entities/expense';
import { useCategories, useExpenses } from '../db/composables';
import { currentMonth } from '../lib/month';
import { formatMoney } from '../lib/money';

/**
 * Карточка «Траты за месяц» на экране «Сегодня»: итог и три крупнейшие
 * категории.
 *
 * Три, а не вся сводка: виджет соседствует с чужими карточками, и полный
 * разбор на дюжину строк вытеснил бы их за экран. За подробностями — в модуль.
 *
 * `RouterLink` берётся глобальной регистрацией, а не импортом: `vue-router` —
 * зависимость ОБОЛОЧКИ, и модуль со своей копией роутера получил бы второй
 * экземпляр с чужой историей.
 */
const PREVIEW = 3;

const expenses = useExpenses();
const categories = useCategories();

const monthly = computed(() => inMonth(expenses.value, currentMonth()));
const total = computed(() => sumAmount(monthly.value));

const top = computed(() => {
  const catalog = byId(categories.value);
  return sumByCategory(monthly.value).slice(0, PREVIEW).map(row => ({
    key: row.category ?? 'none',
    label: nameById(catalog, row.category) ?? 'Без категории',
    color: colorById(catalog, row.category),
    total: row.total,
  }));
});
</script>

<template>
  <div v-if="monthly.length === 0" class="text-[0.8125rem] leading-relaxed text-text-faint">
    В этом месяце пока ни одной траты — запишите первую строкой «250 кофе».
  </div>

  <div v-else class="flex flex-col gap-2">
    <p class="text-display text-2xl leading-none text-text">{{ formatMoney(total) }}</p>

    <ul class="flex flex-col gap-1">
      <li v-for="row in top" :key="row.key" class="flex items-center gap-2 text-[0.8125rem]">
        <span class="size-2 shrink-0 rounded-full" :style="{ background: row.color }" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-text-soft">{{ row.label }}</span>
        <span class="tnum shrink-0 text-text-faint">{{ formatMoney(row.total) }}</span>
      </li>
    </ul>

    <RouterLink to="/finance" class="text-xs text-accent hover:underline">
      открыть финансы
    </RouterLink>
  </div>
</template>
