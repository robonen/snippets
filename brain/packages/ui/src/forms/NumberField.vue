<script setup lang="ts">
import { computed, useId } from 'vue';
import {
  Label,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldRoot,
} from '@robonen/primitives';
import { Minus, Plus } from 'lucide-vue-next';

/**
 * Число с шагом и границами: вес, порция, повторы, сумма.
 *
 * Примитив несёт то, чего не даёт `input[type=number]`: разбор по локали,
 * зажатие кнопки с ускорением, привязку к шагу, `role="spinbutton"` с
 * `aria-valuenow`/`valuemin`/`valuemax`. Здесь — геометрия, единица справа и
 * та же обвязка поля, что у {@link TextField}.
 *
 * Пустое поле — это `null`, а не `0`: «не заполнено» и «ноль» — разные ответы,
 * и подменять первое вторым значит проставить пользователю данные за него.
 */
const {
  label,
  hint,
  error,
  unit,
  min,
  max,
  step = 1,
  snap = true,
  disabled = false,
  fractionDigits,
} = defineProps<{
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /**
   * Подгонять набранное к шагу. Выключать там, где шаг — удобство кнопок «±»,
   * а не ограничение значения: с шагом 500 примитив подгоняет ЧИСЛО НА КАЖДОМ
   * НАЖАТИИ, и набрать «15 000» по цифрам невозможно — «1» тут же становится
   * нулём.
   */
  snap?: boolean;
  /** Единица справа от числа: «г», «ккал», «₽». */
  unit?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  /** Знаков после запятой; по умолчанию число показывается как введено. */
  fractionDigits?: number;
}>();

const value = defineModel<number | null>({ default: null });

const id = useId();
const hintId = `${id}-hint`;
const errorId = `${id}-error`;
const unitId = `${id}-unit`;

// Единица тоже описывает поле: без неё скринридер прочитает «120» и умолчит о
// том, граммы это или килокалории, — а видящий пользователь надпись видит.
const describedBy = computed(() => {
  const parts: string[] = [];
  if (unit !== undefined && unit !== '') parts.push(unitId);
  if (hint !== undefined && hint !== '') parts.push(hintId);
  if (error !== undefined && error !== '') parts.push(errorId);
  return parts.length > 0 ? parts.join(' ') : undefined;
});

const formatOptions = computed<Intl.NumberFormatOptions | undefined>(() => (
  fractionDigits === undefined
    ? undefined
    : { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }
));

const STEPPER = 'pressable grid size-8 shrink-0 place-items-center rounded-control text-text-soft '
  + 'hover:bg-sunken hover:text-text disabled:pointer-events-none disabled:opacity-45';
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label :for="id" class="text-[0.8125rem] font-medium text-text-soft">{{ label }}</Label>

    <NumberFieldRoot
      v-model="value"
      :min="min"
      :max="max"
      :step="step"
      :step-snapping="snap"
      :disabled="disabled"
      :format-options="formatOptions"
      class="flex h-10 w-full items-center gap-1 rounded-control border bg-surface px-1 transition-colors"
      :class="error ? 'border-danger' : 'border-line focus-within:border-line-strong hover:border-line-strong'"
    >
      <NumberFieldDecrement aria-label="Уменьшить" :class="STEPPER">
        <Minus class="size-4" />
      </NumberFieldDecrement>

      <NumberFieldInput
        :id="id"
        :placeholder="placeholder"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="describedBy"
        class="tnum min-w-0 flex-1 bg-transparent text-center text-sm text-text outline-none
               placeholder:text-text-faint disabled:opacity-45"
      />

      <!-- Единица не входит в поле ввода: набранное «120 г» примитив разобрал бы
           как текст, а не как число. -->
      <span v-if="unit" :id="unitId" class="shrink-0 pr-1 text-xs text-text-faint">{{ unit }}</span>

      <NumberFieldIncrement aria-label="Увеличить" :class="STEPPER">
        <Plus class="size-4" />
      </NumberFieldIncrement>
    </NumberFieldRoot>

    <p v-if="hint && !error" :id="hintId" class="text-xs text-text-faint">{{ hint }}</p>
    <p v-if="error" :id="errorId" class="text-xs text-danger">{{ error }}</p>
  </div>
</template>
