<script setup lang="ts">
import { computed } from 'vue';
import { Menu } from '@brain/ui';
import type { MenuAction } from '@brain/ui';
import { colorOf } from '../../entities/category';
import type { Category } from '../../entities/category';
import type { Expense } from '../../entities/expense';
import { formatAmount } from '../../lib/money';

/**
 * Строка списка трат.
 *
 * Вся строка — кнопка правки: трата состоит из трёх полей, и отдельная иконка
 * «править» отняла бы место у суммы ради действия, которое всё равно главное.
 * Разрушающее — в меню, отдельно от зоны нажатия.
 *
 * Категория — МЕТКА-ТОЧКА, а не заливка и не плашка: цвет здесь помогает найти
 * строку взглядом, а называет категорию имя. Заливка на шестидесяти строках
 * месяца кричала бы там, где достаточно сообщить.
 *
 * Знак валюты в строке не повторяется: он стоит один раз на итоге дня, и
 * шестьдесят рублёвых значков в списке ничего не добавляют к смыслу.
 */
const { expense, category } = defineProps<{ expense: Expense; category?: Category }>();

const emit = defineEmits<{
  edit: [];
  remove: [];
}>();

const color = computed(() => (category === undefined ? 'var(--line-strong)' : colorOf(category.colorKey)));
const title = computed(() => expense.note ?? category?.name ?? 'Без описания');

// Подпись только тогда, когда она не повторяет заголовок. Подписку помечаем
// словом: одинаковая сумма каждый месяц иначе выглядит как двойная запись.
const subtitle = computed(() => {
  const parts: string[] = [];
  if (expense.note !== undefined && category !== undefined) parts.push(category.name);
  if (expense.recurring !== undefined) parts.push('по подписке');
  return parts.length === 0 ? undefined : parts.join(' · ');
});

const menu: MenuAction[] = [
  { id: 'edit', title: 'Править', onSelect: () => emit('edit') },
  { id: 'remove', title: 'Удалить', danger: true, onSelect: () => emit('remove') },
];
</script>

<template>
  <li class="flex items-center gap-1 pr-2">
    <button
      type="button"
      class="pressable flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-4 text-left hoverable"
      @click="emit('edit')"
    >
      <span aria-hidden="true" class="size-2 shrink-0 rounded-full" :style="{ background: color }" />

      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm text-text">{{ title }}</span>
        <span v-if="subtitle" class="block truncate text-xs text-text-faint">{{ subtitle }}</span>
      </span>

      <span class="tnum shrink-0 text-sm text-text">{{ formatAmount(expense.amount) }}</span>
    </button>

    <Menu :items="menu" :label="`Действия: ${title}`" />
  </li>
</template>
