<script setup lang="ts">
import { computed, watch } from 'vue';
import { useForm } from '@robonen/vue';
import { Button, SegmentedControl, Sheet, TextField } from '@brain/ui';
import type { Segment } from '@brain/ui';
import { PROJECT_STATUSES, STATUS_LABELS } from '../../entities/project';
import type { ProjectStatus } from '../../entities/project';
import type { NewProject } from '../../db/actions';
import { parseMonth } from '../../lib/format';
import MonthField from '../MonthField.vue';

/**
 * Заведение проекта: название, месяц начала и статус — три поля, не больше.
 *
 * Всё остальное — стек, команда, оплаты — заполняется на экране проекта, куда
 * форма и ведёт. Форма на пятнадцать полей отпугивает от самого заведения, а
 * проект, которого нет в списке, не получит ни одной оплаты.
 *
 * Статус спрашивается сразу, потому что сюда попадают и давно закрытые проекты:
 * человек переносит историю, и «завёл как активный, потом переключил» — лишний
 * шаг на каждом из десяти.
 */
const { defaultMonth } = defineProps<{
  /** Текущий месяц — начало по умолчанию. */
  defaultMonth: string;
}>();

const emit = defineEmits<{ create: [draft: NewProject] }>();

const open = defineModel<boolean>('open', { default: false });

const STATUS_SEGMENTS: Array<Segment<ProjectStatus>> = PROJECT_STATUSES.map(item => ({
  value: item,
  label: STATUS_LABELS[item],
}));

const currentYear = computed(() => parseMonth(defaultMonth)?.year ?? new Date().getFullYear());

function check(values: NewProject): { values: NewProject; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  if (values.title.trim() === '') errors['title'] = ['Дайте проекту название'];
  if (parseMonth(values.startedAt) === null) errors['startedAt'] = ['Укажите месяц начала'];
  return { values, errors };
}

function initial(): NewProject {
  return { title: '', startedAt: defaultMonth, status: 'active' };
}

const form = useForm<NewProject>({ initialValues: initial(), resolver: check });
const [title] = form.defineField('title');
const [startedAt] = form.defineField('startedAt');
const [status] = form.defineField('status');

// Значения ставятся на ОТКРЫТИИ: лист живёт в дереве постоянно, и прошлое
// название не должно встречать следующее заведение.
watch(open, (isOpen) => {
  if (isOpen) form.resetForm({ values: initial() });
});

const submit = form.handleSubmit((values) => {
  emit('create', { title: values.title.trim(), startedAt: values.startedAt, status: values.status });
  open.value = false;
});
</script>

<template>
  <Sheet v-model:open="open" title="Новый проект" description="Остальное заполните на странице проекта.">
    <form class="flex flex-col gap-3.5" novalidate @submit.prevent="submit">
      <TextField
        v-model="title"
        label="Название"
        placeholder="Forma Media"
        autocomplete="off"
        required
        :error="form.getError('title')"
      />

      <MonthField
        v-model="startedAt"
        label="Начало"
        :from-year="currentYear - 10"
        :to-year="currentYear + 1"
      />

      <SegmentedControl v-model="status" label="Статус" :segments="STATUS_SEGMENTS" />

      <!-- Скрытая кнопка: Enter в поле обязан отправлять форму, а видимая
           кнопка живёт в подвале листа, вне <form>. -->
      <button type="submit" class="sr-only" tabindex="-1">Создать</button>
    </form>

    <template #footer>
      <Button tone="primary" block @click="submit()">Создать проект</Button>
    </template>
  </Sheet>
</template>
