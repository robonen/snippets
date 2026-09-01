<script setup lang="ts">
import { computed, shallowRef, useId } from 'vue';
import { CalendarDays } from 'lucide-vue-next';
import {
  DatePickerAnchor,
  DatePickerClose,
  DatePickerContent,
  DatePickerFieldRoot,
  DatePickerFieldSegment,
  DatePickerPortal,
  DatePickerRoot,
  DatePickerTrigger,
  Label,
} from '@robonen/primitives';
import DateCalendar from './DateCalendar.vue';

/**
 * Поле даты: сегменты «дд.мм.гггг» плюс календарь по кнопке.
 *
 * Сегменты, а не одна строка: известную дату быстрее НАБРАТЬ — «05», «06»,
 * «2023», — чем выцеливать в календаре, а стрелки вверх-вниз на сегменте
 * заменяют «на день раньше». Календарь остаётся для дат, которых не помнишь
 * числом: «та пятница», «конец месяца».
 *
 * Не `<input type="date">`: он в каждом браузере свой, на ноутбуке в Safari и
 * Firefox набирается хуже, чем сегменты, и не подчиняется теме. Примитив
 * рисуется нашей разметкой и в нашей теме везде одинаково.
 *
 * Календарь якорится ко ВСЕМУ полю, а не к кнопке справа: он раскрывается под
 * полем и той же ширины, как выпадающий список у {@link Select}.
 *
 * Значение — ISO-дата `YYYY-MM-DD` или пустая строка: ровно то, что лежит в
 * ленде, без часовых поясов и `Date` наружу.
 */
const {
  label,
  hint,
  error,
  required = false,
  disabled = false,
  min,
  max,
} = defineProps<{
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** Ранняя граница, ISO-дата. */
  min?: string;
  /** Поздняя граница, ISO-дата. */
  max?: string;
}>();

const value = defineModel<string>({ default: '' });

const id = useId();
const hintId = `${id}-hint`;
const errorId = `${id}-error`;

const describedBy = computed(() => {
  const parts: string[] = [];
  if (hint !== undefined && hint !== '') parts.push(hintId);
  if (error !== undefined && error !== '') parts.push(errorId);
  return parts.length > 0 ? parts.join(' ') : undefined;
});

// Примитив живёт на `Date`, ленд — на строках. Перевод только по локальным
// компонентам: `new Date('2023-06-05')` — это полночь по UTC, и к западу от
// Гринвича она выпадает на 4 июня.
const date = computed<Date | undefined>({
  get: () => fromISO(value.value),
  set: (next) => {
    value.value = next === undefined ? '' : toISO(next);
  },
});

const minDate = computed(() => fromISO(min ?? ''));
const maxDate = computed(() => fromISO(max ?? ''));

const open = shallowRef(false);

/** «Сегодня» — самая частая дата, и её не нужно искать по сетке. */
function pickToday(): void {
  date.value = new Date();
  open.value = false;
}

function fromISO(iso: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
  if (match === null) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toISO(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label :for="id" class="text-[0.8125rem] font-medium text-text-soft">
      {{ label }}
      <span v-if="required" aria-hidden="true" class="text-danger">*</span>
    </Label>

    <!-- `required` примитиву не передаётся: с ним он рисует под сегментами
         скрытый родной `input[type=date]` для валидации формы, и читалка
         объявляет дату дважды. Обязательность здесь — звёздочка и проверка
         самой формы. -->
    <DatePickerRoot
      :id="id"
      v-model="date"
      v-model:open="open"
      locale="ru"
      calendar-label="Календарь"
      :week-starts-on="1"
      :min-value="minDate"
      :max-value="maxDate"
      :disabled="disabled"
      close-on-select
    >
      <DatePickerAnchor
        class="flex h-10 w-full items-center rounded-control border bg-surface transition-colors
               focus-within:border-line-strong"
        :class="[error ? 'border-danger' : 'border-line hover:border-line-strong', disabled && 'opacity-45']"
      >
        <DatePickerFieldRoot
          v-slot="{ segments }"
          class="tnum flex min-w-0 flex-1 items-center px-3 text-sm text-text"
          :aria-invalid="error ? true : undefined"
          :aria-describedby="describedBy"
        >
          <!-- Значение сегмента рендерится из слота: у литералов один и тот же
               `part`, и примитив сам показал бы первый из них на месте каждого. -->
          <DatePickerFieldSegment
            v-for="(segment, at) in segments"
            :key="at"
            :part="segment.part"
            class="rounded-xs px-px outline-none focus:bg-accent/15 data-[placeholder]:text-text-faint"
          >
            {{ segment.value }}
          </DatePickerFieldSegment>
        </DatePickerFieldRoot>

        <DatePickerTrigger
          :aria-label="`Календарь: ${label}`"
          class="pressable grid h-full w-10 shrink-0 place-items-center rounded-r-control text-text-faint
                 hover:text-text data-[state=open]:text-accent"
        >
          <CalendarDays class="size-4" />
        </DatePickerTrigger>
      </DatePickerAnchor>

      <DatePickerPortal>
        <!-- Ширина — от якоря, в пределах 18–24rem: узкому полю календарь всё
             равно нужен целиком, а под широким сетка на всю ширину рассыпалась
             бы редкими цифрами. Переменные поппера — сырые `--popper-*`, как у
             `Combobox`. -->
        <DatePickerContent
          side="bottom"
          align="start"
          :side-offset="6"
          :collision-padding="12"
          class="glass z-50 w-(--popper-anchor-width) max-w-[min(24rem,calc(100vw-1.5rem))] min-w-72
                 origin-(--popper-transform-origin) rounded-card border p-3 shadow-float
                 data-[state=open]:animate-[scale-in_var(--duration-menu)_var(--ease-out)]
                 data-[state=open]:motion-reduce:animate-[fade-in_var(--duration-hint)_var(--ease-out)]"
        >
          <DateCalendar />

          <div class="mt-2 flex items-center justify-between border-t border-line pt-2">
            <button
              type="button"
              class="pressable rounded-control px-2 py-1 text-xs font-medium text-text-soft hover:bg-sunken hover:text-text"
              @click="pickToday"
            >
              Сегодня
            </button>
            <DatePickerClose
              class="pressable rounded-control px-2 py-1 text-xs text-text-faint hover:bg-sunken hover:text-text"
              @click="value = ''"
            >
              Очистить
            </DatePickerClose>
          </div>
        </DatePickerContent>
      </DatePickerPortal>
    </DatePickerRoot>

    <p v-if="hint && !error" :id="hintId" class="text-xs text-text-faint">{{ hint }}</p>
    <p v-if="error" :id="errorId" class="text-xs text-danger">{{ error }}</p>
  </div>
</template>
