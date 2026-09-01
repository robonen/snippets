<script setup lang="ts">
import { computed, onMounted, useId, watch } from 'vue';
import { maskNumberOptions, useMaskedInput } from '@robonen/vue';
import type { MaskOptions, MaskPostprocessor } from '@robonen/vue';
import { Label } from '@robonen/primitives';

/**
 * Сумма в рублях: разряды разделяются на лету, «₽» стоит в самом поле.
 *
 * Это маска поверх обычного текстового поля (`useMaskedInput`), а не
 * {@link NumberField}: у денег нет ни шага, ни кнопок «±», зато есть привычная
 * запись «150 000 ₽», и её удобнее видеть в момент набора, а не после.
 *
 * Наружу — число или `null`: «не заполнено» и «ноль» — разные ответы, и
 * подменять первое вторым значит проставить данные за пользователя.
 */
const {
  label,
  hint,
  error,
  required = false,
  disabled = false,
  max,
} = defineProps<{
  label: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** Верхняя граница: набранное сверх неё маска сама осаживает. */
  max?: number;
}>();

const value = defineModel<number | null>({ default: null });

const id = useId();
const hintId = `${id}-hint`;
const errorId = `${id}-error`;

const describedBy = computed(() => {
  const parts: string[] = [];
  if (hint !== undefined && hint !== '') parts.push(hintId);
  if (error !== undefined && error !== '') parts.push(errorId);
  return parts.length > 0 ? parts.join(' ') : undefined;
});

/** Без цифр поле пустое: постфикс «₽» сам по себе прятал бы плейсхолдер. */
const blankWithoutDigits: MaskPostprocessor = state => (/\d/u.test(state.value) ? state : { value: '', selection: [0, 0] });

const options = computed<MaskOptions>(() => {
  const base = maskNumberOptions({ thousandSeparator: ' ', precision: 0, postfix: ' ₽', ...(max !== undefined && { max }) });
  return { ...base, postprocessors: [...(base.postprocessors ?? []), blankWithoutDigits] };
});

const { bind, unmasked, setValue } = useMaskedInput({
  mask: () => options.value,
  onAccept: ({ unmasked: raw }) => {
    const next = raw === '' ? null : Number(raw);
    if (next !== value.value) value.value = next;
  },
});

// Библиотека документирует `<input v-bind="bind">`; её `ref` типизирован уже,
// чем `VNodeRef` во Vue, поэтому привязки уходят в шаблон обычными атрибутами.
const inputBindings: Record<string, unknown> = { ...bind };

// Значение снаружи (сброс формы, правка записи) проходит через ту же маску,
// что и набор: иначе поле показало бы «15000» без разрядов и без «₽».
function sync(): void {
  const raw = value.value === null ? '' : String(value.value);
  if (raw !== unmasked.value) setValue(raw);
}

onMounted(sync);
watch(value, sync);
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label :for="id" class="text-[0.8125rem] font-medium text-text-soft">
      {{ label }}
      <span v-if="required" aria-hidden="true" class="text-danger">*</span>
    </Label>

    <input
      v-bind="inputBindings"
      :id="id"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="error ? true : undefined"
      :aria-describedby="describedBy"
      class="tnum h-10 w-full rounded-control border bg-surface px-3 text-sm text-text
             transition-colors placeholder:text-text-faint disabled:opacity-45"
      :class="error ? 'border-danger' : 'border-line hover:border-line-strong focus:border-line-strong'"
    >

    <p v-if="hint && !error" :id="hintId" class="text-xs text-text-faint">{{ hint }}</p>
    <p v-if="error" :id="errorId" class="text-xs text-danger">{{ error }}</p>
  </div>
</template>
