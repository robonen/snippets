<script setup lang="ts">
import { computed } from 'vue';
import { Select } from '@brain/ui';
import type { SelectOption } from '@brain/ui';
import { MONTHS, parseMonth, toMonth } from '../lib/format';

/**
 * Месяц и год двумя списками.
 *
 * Не `<input type="month">`: его нет в Safari и Firefox на ноутбуке, и там он
 * молча превращается в текстовое поле. Два списка работают везде и ровно
 * повторяют, как о периоде думают: «март… двадцать третьего».
 *
 * Годы — от первого проекта до следующего года: список на сто лет заставил бы
 * прокручивать, а год за пределами диапазона всё равно попадает в список, если
 * он уже стоит в значении.
 */
const { label, fromYear, toYear } = defineProps<{
  label: string;
  /** Нижняя граница списка лет. */
  fromYear: number;
  /** Верхняя граница — обычно следующий за текущим год. */
  toYear: number;
  disabled?: boolean;
}>();

const value = defineModel<string>({ required: true });

const parsed = computed(() => parseMonth(value.value));

const monthOptions: SelectOption[] = MONTHS.map((name, at) => ({ value: String(at + 1), label: name }));

const yearOptions = computed<SelectOption[]>(() => {
  const own = parsed.value?.year;
  const low = Math.min(fromYear, own ?? fromYear);
  const high = Math.max(toYear, own ?? toYear);
  const years: SelectOption[] = [];
  for (let year = high; year >= low; year -= 1) years.push({ value: String(year), label: String(year) });
  return years;
});

const month = computed({
  get: () => (parsed.value === null ? undefined : String(parsed.value.month)),
  set: (next) => {
    if (next === undefined || parsed.value === null) return;
    value.value = toMonth(parsed.value.year, Number(next));
  },
});

const year = computed({
  get: () => (parsed.value === null ? undefined : String(parsed.value.year)),
  set: (next) => {
    if (next === undefined || parsed.value === null) return;
    value.value = toMonth(Number(next), parsed.value.month);
  },
});
</script>

<template>
  <fieldset class="flex min-w-0 flex-col gap-1.5" :disabled="disabled">
    <legend class="mb-1.5 text-xs font-medium text-text-soft">{{ label }}</legend>
    <div class="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2">
      <Select v-model="month" :label="`${label}: месяц`" :options="monthOptions" :disabled="disabled" class="[&_label]:sr-only" />
      <Select v-model="year" :label="`${label}: год`" :options="yearOptions" :disabled="disabled" class="[&_label]:sr-only" />
    </div>
  </fieldset>
</template>
