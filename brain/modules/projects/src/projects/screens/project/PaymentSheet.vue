<script setup lang="ts">
import { watch } from 'vue';
import { useForm } from '@robonen/vue';
import { Button, DateField, MoneyField, Sheet, TextField } from '@brain/ui';
import { newId } from '@brain/module-kit';
import type { Payment } from '../../entities/project';

/**
 * Оплата: дата, сумма, моя доля, за что. Добавление и правка одним листом.
 *
 * Доля — отдельное поле, а не «сумма × процент»: в файле она писалась в скобках
 * («50 000 руб. (25 000 руб.)»), потому что делили не по проценту, а по
 * договорённости на каждый платёж.
 *
 * Состояние и проверки — `useForm`: ошибки показываются после первой попытки
 * сохранить и гаснут по мере исправления, а не блокируют кнопку молча.
 */
const { payment, today } = defineProps<{
  payment?: Payment;
  today: string;
}>();

const emit = defineEmits<{ save: [payment: Payment] }>();

const open = defineModel<boolean>('open', { default: false });

interface PaymentValues {
  date: string;
  amount: number | null;
  share: number | null;
  note: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function check(values: PaymentValues): { values: PaymentValues; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  if (!ISO_DATE.test(values.date)) errors['date'] = ['Нужна дата платежа'];
  if (values.amount === null || values.amount <= 0) errors['amount'] = ['Сумма должна быть больше нуля'];
  if (values.share !== null && values.amount !== null && values.share > values.amount) {
    errors['share'] = ['Доля не может быть больше платежа'];
  }
  return { values, errors };
}

function initial(): PaymentValues {
  return {
    date: payment?.date ?? today,
    amount: payment?.amount ?? null,
    share: payment?.share ?? null,
    note: payment?.note ?? '',
  };
}

const form = useForm<PaymentValues>({ initialValues: initial(), resolver: check });
const [date] = form.defineField('date');
const [amount] = form.defineField('amount');
const [share] = form.defineField('share');
const [note] = form.defineField('note');

// Значения ставятся на ОТКРЫТИИ, а не на смене пропа: лист живёт в дереве
// постоянно, и сброс по `payment` затирал бы наполовину заполненную форму.
watch(open, (isOpen) => {
  if (isOpen) form.resetForm({ values: initial() });
});

const submit = form.handleSubmit((values) => {
  const own = values.share;
  emit('save', {
    id: payment?.id ?? newId(),
    date: values.date,
    amount: values.amount ?? 0,
    // Доля, равная сумме или нулевая, — это её отсутствие: не делили.
    ...(own !== null && own > 0 && own !== values.amount && { share: own }),
    note: values.note.trim(),
    addedAt: payment?.addedAt ?? Date.now(),
  });
  open.value = false;
});
</script>

<template>
  <Sheet v-model:open="open" :title="payment ? 'Правка оплаты' : 'Новая оплата'">
    <form class="flex flex-col gap-3.5" novalidate @submit.prevent="submit">
      <DateField v-model="date" label="Дата" required :error="form.getError('date')" />

      <MoneyField
        v-model="amount"
        label="Сумма"
        placeholder="50 000 ₽"
        hint="Платёж целиком, как пришёл."
        required
        :error="form.getError('amount')"
      />

      <MoneyField
        v-model="share"
        label="Моя доля"
        placeholder="вся сумма"
        hint="Если платёж делился на команду. Пусто — всё моё."
        :error="form.getError('share')"
      />

      <TextField v-model="note" label="За что" placeholder="Первая итерация, хостинг, перенос" autocomplete="off" />

      <!-- Скрытая кнопка: Enter в поле обязан отправлять форму, а видимая
           кнопка живёт в подвале листа, вне <form>. -->
      <button type="submit" class="sr-only" tabindex="-1">Сохранить</button>
    </form>

    <template #footer>
      <Button tone="primary" block @click="submit()">
        {{ payment ? 'Сохранить' : 'Добавить оплату' }}
      </Button>
    </template>
  </Sheet>
</template>
