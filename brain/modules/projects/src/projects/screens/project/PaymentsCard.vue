<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { Plus } from 'lucide-vue-next';
import { Button, Card, Disclosure, Menu, Meter, MoneyField, StatTile } from '@brain/ui';
import type { MenuAction } from '@brain/ui';
import { myTotal, paidTotal, remainderOf } from '../../entities/project';
import type { Payment, Project } from '../../entities/project';
import { fmtDay, fmtMoney } from '../../lib/format';
import PaymentSheet from './PaymentSheet.vue';

/**
 * Оплаты проекта: итоги крупно, стоимость по договору, список платежей.
 *
 * Остаток — то, ради чего таблица в файле вообще велась («Остаток — 152 500
 * руб.»), и здесь он считается сам: стоимость минус полученное. Без стоимости
 * остатка нет, и плитка не показывается — «0 ₽» врал бы про закрытый договор.
 */
const { project, today } = defineProps<{
  project: Project;
  today: string;
}>();

const emit = defineEmits<{ update: [project: Project] }>();

const sheet = shallowRef(false);
const editing = shallowRef<Payment | undefined>();

const paid = computed(() => paidTotal(project));
const mine = computed(() => myTotal(project));
const remainder = computed(() => remainderOf(project));
/** Доля отличается от суммы хотя бы раз — иначе две одинаковые плитки. */
const shared = computed(() => project.payments.some(payment => payment.share !== undefined));

/** Новые сверху: последняя оплата — та, о которой сейчас думают. */
const rows = computed(() => [...project.payments].sort((a, b) => b.date.localeCompare(a.date) || b.addedAt - a.addedAt));

const budget = computed({
  get: () => project.budget ?? null,
  set: (next) => {
    if (next === null || next <= 0) {
      const { budget: _dropped, ...rest } = project;
      emit('update', rest);
      return;
    }
    emit('update', { ...project, budget: next });
  },
});

const budgetOpen = shallowRef(project.budget !== undefined);

function add(): void {
  editing.value = undefined;
  sheet.value = true;
}

function edit(payment: Payment): void {
  editing.value = payment;
  sheet.value = true;
}

function save(payment: Payment): void {
  const others = project.payments.filter(item => item.id !== payment.id);
  emit('update', { ...project, payments: [...others, payment] });
}

function drop(id: string): void {
  emit('update', { ...project, payments: project.payments.filter(item => item.id !== id) });
}

function menuOf(payment: Payment): MenuAction[] {
  return [
    { id: 'edit', title: 'Править', onSelect: () => edit(payment) },
    { id: 'remove', title: 'Удалить', danger: true, onSelect: () => drop(payment.id) },
  ];
}
</script>

<template>
  <Card title="Оплаты">
    <template #action>
      <Button tone="ghost" size="sm" @click="add">
        <Plus class="size-4" />
        Оплата
      </Button>
    </template>

    <div class="flex flex-col gap-3">
      <div v-if="project.payments.length > 0 || project.budget !== undefined" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatTile :value="fmtMoney(paid)" label="получено" />
        <StatTile v-if="shared" :value="fmtMoney(mine)" label="моя доля" />
        <StatTile
          v-if="remainder !== undefined"
          :value="fmtMoney(remainder)"
          :label="remainder > 0 ? 'остаток' : 'оплачено сверх'"
        />
      </div>

      <Meter
        v-if="project.budget !== undefined && project.budget > 0"
        :value="paid"
        :max="project.budget"
        label="По договору"
        :caption="`${fmtMoney(paid)} из ${fmtMoney(project.budget)}`"
      />

      <Disclosure v-model:open="budgetOpen" title="Стоимость по договору" :hint="project.budget === undefined ? 'не указана' : fmtMoney(project.budget)">
        <MoneyField
          v-model="budget"
          label="Стоимость"
          placeholder="не указана"
          hint="Остаток считается как стоимость минус полученное. Пусто — остаток не нужен."
        />
      </Disclosure>

      <ul v-if="rows.length > 0" class="flex flex-col divide-y divide-line">
        <li v-for="payment in rows" :key="payment.id" class="flex items-center gap-2 py-2 last:pb-0">
          <span class="tnum w-22 shrink-0 text-xs text-text-faint">{{ fmtDay(payment.date) }}</span>
          <span class="min-w-0 flex-1 truncate text-sm text-text">{{ payment.note || 'Оплата' }}</span>
          <span class="tnum shrink-0 text-right text-sm">
            <span class="block text-text">{{ fmtMoney(payment.amount) }}</span>
            <span v-if="payment.share !== undefined" class="block text-xs text-text-faint">{{ `моя ${fmtMoney(payment.share)}` }}</span>
          </span>
          <Menu :items="menuOf(payment)" :label="`Оплата ${fmtDay(payment.date)}`" />
        </li>
      </ul>
      <p v-else class="text-xs text-text-faint">Платежей пока нет. Каждый — с датой, суммой и вашей долей, если делили.</p>
    </div>

    <PaymentSheet v-model:open="sheet" :payment="editing" :today="today" @save="save" />
  </Card>
</template>
