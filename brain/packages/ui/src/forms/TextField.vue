<script setup lang="ts">
import { computed, useId } from 'vue';
import { Label } from '@robonen/primitives';

/**
 * Поле ввода с подписью, подсказкой и ошибкой.
 *
 * Связи между ними держатся на id, а не на порядке в разметке: подпись через
 * `for`, подсказка и ошибка — через `aria-describedby`. Иначе скринридер
 * прочитает поле без причины, по которой оно покраснело.
 */
const {
  label,
  type = 'text',
  hint,
  error,
  required = false,
  disabled = false,
} = defineProps<{
  label: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'search' | 'url' | 'tel';
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  inputmode?: 'text' | 'numeric' | 'decimal' | 'email' | 'search' | 'url' | 'tel';
  autocomplete?: string;
}>();

const value = defineModel<string | number | undefined>();

const id = useId();
const hintId = `${id}-hint`;
const errorId = `${id}-error`;

const describedBy = computed(() => {
  const parts: string[] = [];
  if (hint !== undefined && hint !== '') parts.push(hintId);
  if (error !== undefined && error !== '') parts.push(errorId);
  return parts.length > 0 ? parts.join(' ') : undefined;
});
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label :for="id" class="text-[0.8125rem] font-medium text-text-soft">
      {{ label }}
      <span v-if="required" aria-hidden="true" class="text-danger">*</span>
    </Label>

    <input
      :id="id"
      v-model="value"
      :type="type"
      :placeholder="placeholder"
      :required="required"
      :disabled="disabled"
      :inputmode="inputmode"
      :autocomplete="autocomplete"
      :aria-invalid="error ? true : undefined"
      :aria-describedby="describedBy"
      class="h-10 w-full rounded-control border bg-surface px-3 text-sm text-text
             transition-colors placeholder:text-text-faint disabled:opacity-45"
      :class="error ? 'border-danger' : 'border-line hover:border-line-strong'"
    >

    <p v-if="hint && !error" :id="hintId" class="text-xs text-text-faint">{{ hint }}</p>
    <p v-if="error" :id="errorId" class="text-xs text-danger">{{ error }}</p>
  </div>
</template>
