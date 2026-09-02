<script setup lang="ts">
import { computed, useId, watch } from 'vue';
import { useForm } from '@robonen/vue';
import { X } from 'lucide-vue-next';
import { Button, Card, DateField } from '@brain/ui';
import type { Entry } from '../../entities/project';
import { newId } from '@brain/module-kit';
import { fmtDay } from '../../lib/format';

/**
 * Журнал проекта: что решили, что случилось, когда сменился статус.
 *
 * Поле записи стоит НАД списком и всегда открыто: журнал ведут в момент
 * события, и лишнее нажатие «добавить запись» — это запись, которой не будет.
 * Дата по умолчанию сегодняшняя, но правится: вспомнить и записать вчерашнее —
 * нормально.
 */
const { journal, today } = defineProps<{
  journal: Entry[];
  today: string;
}>();

const emit = defineEmits<{ update: [journal: Entry[]] }>();

const textId = useId();

interface EntryValues {
  date: string;
  text: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function check(values: EntryValues): { values: EntryValues; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  if (!ISO_DATE.test(values.date)) errors['date'] = ['Нужна дата события'];
  if (values.text.trim() === '') errors['text'] = ['Запись пуста'];
  return { values, errors };
}

const form = useForm<EntryValues>({ initialValues: { date: today, text: '' }, resolver: check });
const [date] = form.defineField('date');
const [text] = form.defineField('text');

// Смена дня в открытой вкладке подтягивает дату, пока её не трогали.
watch(() => today, (next) => {
  if (!form.isFieldDirty('date')) form.setFieldValue('date', next);
});

const rows = computed(() => [...journal].sort((a, b) => b.date.localeCompare(a.date) || b.addedAt - a.addedAt));

const submit = form.handleSubmit((values) => {
  emit('update', [...journal, { id: newId(), date: values.date, text: values.text.trim(), addedAt: Date.now() }]);
  // Дата остаётся: следующую запись чаще делают тем же днём.
  form.resetForm({ values: { date: values.date, text: '' } });
});

function drop(id: string): void {
  emit('update', journal.filter(entry => entry.id !== id));
}
</script>

<template>
  <Card title="Журнал">
    <form class="flex flex-col gap-2.5" novalidate @submit.prevent="submit">
      <div class="grid gap-2.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
        <DateField v-model="date" label="Дата" :error="form.getError('date')" />
        <div class="flex flex-col gap-1.5">
          <label :for="textId" class="text-[0.8125rem] font-medium text-text-soft">Что произошло</label>
          <textarea
            :id="textId"
            v-model="text"
            rows="1"
            placeholder="Договорились о втором этапе, сдали макеты, заказчик пропал…"
            :aria-invalid="form.getError('text') ? true : undefined"
            class="field-sizing-content min-h-10 w-full resize-none rounded-control border bg-surface px-3 py-2
                   text-sm leading-relaxed text-text transition-colors placeholder:text-text-faint
                   focus:border-line-strong focus:outline-none"
            :class="form.getError('text') ? 'border-danger' : 'border-line hover:border-line-strong'"
            @keydown.enter.exact.prevent="submit()"
          />
          <p v-if="form.getError('text')" class="text-xs text-danger">{{ form.getError('text') }}</p>
        </div>
      </div>
      <div>
        <Button type="submit" tone="primary" size="sm">Записать</Button>
      </div>
    </form>

    <ol v-if="rows.length > 0" class="mt-4 flex flex-col divide-y divide-line border-t border-line">
      <li v-for="entry in rows" :key="entry.id" class="flex items-start gap-3 py-2.5">
        <time :datetime="entry.date" class="tnum w-22 shrink-0 pt-0.5 text-xs text-text-faint">{{ fmtDay(entry.date) }}</time>
        <p class="min-w-0 flex-1 text-sm leading-relaxed whitespace-pre-line text-text">{{ entry.text }}</p>
        <button
          type="button"
          :aria-label="`Удалить запись от ${fmtDay(entry.date)}`"
          class="pressable grid size-7 shrink-0 place-items-center rounded-control text-text-faint
                 hover:bg-sunken hover:text-text"
          @click="drop(entry.id)"
        >
          <X class="size-3.5" />
        </button>
      </li>
    </ol>
    <p v-else class="mt-3 text-xs text-text-faint">Записей пока нет. Смена статуса попадает сюда сама.</p>
  </Card>
</template>
