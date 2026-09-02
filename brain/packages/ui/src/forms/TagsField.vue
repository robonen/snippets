<script setup lang="ts">
import { computed, shallowRef, useId } from 'vue';
import { Plus, X } from 'lucide-vue-next';
import {
  Label,
  TagsInputInput,
  TagsInputItem,
  TagsInputItemDelete,
  TagsInputItemText,
  TagsInputRoot,
} from '@robonen/primitives';

/**
 * Список коротких значений — теги, стек, ярлыки — одной строкой ввода.
 *
 * Enter, запятая и потеря фокуса превращают набранное в чипс, Backspace на
 * пустом поле снимает последний, стрелки ходят по чипсам — всё это делает
 * примитив `TagsInput`, вместе с ролями и объявлениями для читалки.
 *
 * Подсказки — ряд кнопок под полем, а не выпадающий список: значений обычно
 * с десяток, и увидеть их все разом быстрее, чем листать. По мере набора ряд
 * сужается до подходящих.
 */
const {
  label,
  hint,
  error,
  suggestions = [],
  max = 0,
  disabled = false,
  placeholder = 'Введите и нажмите Enter',
  normalize = (raw: string) => raw.trim(),
} = defineProps<{
  label: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  /** Что предложить одним нажатием — из того, что уже есть в каталоге. */
  suggestions?: readonly string[];
  /** Предел числа значений; 0 — без предела. */
  max?: number;
  disabled?: boolean;
  /**
   * Привести набранное к каноническому виду до того, как оно станет чипсом:
   * «#Vue» и «vue» обязаны схлопнуться в одно значение. Пустой результат
   * отбрасывается.
   */
  normalize?: (raw: string) => string;
}>();

const tags = defineModel<string[]>({ required: true });

const id = useId();
const hintId = `${id}-hint`;
const errorId = `${id}-error`;

/** Что набрано, но ещё не превращено в чипс — им сужаются подсказки. */
const draft = shallowRef('');

const SUGGESTED = 8;

const describedBy = computed(() => {
  const parts: string[] = [];
  if (hint !== undefined && hint !== '') parts.push(hintId);
  if (error !== undefined && error !== '') parts.push(errorId);
  return parts.length > 0 ? parts.join(' ') : undefined;
});

function has(name: string): boolean {
  const needle = name.toLowerCase();
  return tags.value.some(tag => tag.toLowerCase() === needle);
}

const shown = computed(() => {
  const needle = draft.value.trim().toLowerCase();
  return suggestions
    .filter(name => !has(name))
    .filter(name => needle === '' || name.toLowerCase().includes(needle))
    .slice(0, SUGGESTED);
});

/** Список от примитива — уже через `normalize`; пустое и повторы не проходят. */
function onUpdate(next: string[] | null | undefined): void {
  const clean: string[] = [];
  for (const name of next ?? []) {
    if (name !== '' && !clean.some(item => item.toLowerCase() === name.toLowerCase())) clean.push(name);
  }
  tags.value = clean;
}

function add(raw: string): void {
  const name = normalize(raw);
  if (disabled || name === '' || has(name)) return;
  if (max > 0 && tags.value.length >= max) return;
  tags.value = [...tags.value, name];
  draft.value = '';
}

function onDraft(event: Event): void {
  draft.value = (event.target as HTMLInputElement).value;
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label :for="id" class="text-[0.8125rem] font-medium text-text-soft">{{ label }}</Label>

    <TagsInputRoot
      :id="id"
      :model-value="tags"
      :max="max"
      :disabled="disabled"
      :convert-value="normalize"
      add-on-blur
      add-on-paste
      class="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-control border bg-surface px-2 py-1.5
             transition-colors focus-within:border-line-strong data-[invalid]:border-danger"
      :class="[error ? 'border-danger' : 'border-line hover:border-line-strong', disabled && 'opacity-45']"
      @update:model-value="onUpdate"
      @add-tag="draft = ''"
    >
      <TagsInputItem
        v-for="tag in tags"
        :key="tag"
        :value="tag"
        class="inline-flex h-7 max-w-full items-center gap-0.5 rounded-full bg-accent/10 pr-1 pl-2.5 text-xs
               font-medium text-accent data-[state=active]:ring-2 data-[state=active]:ring-accent/40"
      >
        <TagsInputItemText class="truncate" />
        <TagsInputItemDelete
          :aria-label="`Убрать ${tag}`"
          class="pressable grid size-5 shrink-0 place-items-center rounded-full hover:bg-accent/15"
        >
          <X class="size-3" />
        </TagsInputItemDelete>
      </TagsInputItem>

      <TagsInputInput
        :placeholder="tags.length === 0 ? placeholder : ''"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="describedBy"
        class="h-7 min-w-28 flex-1 bg-transparent px-1 text-sm text-text outline-none placeholder:text-text-faint"
        @input="onDraft"
      />
    </TagsInputRoot>

    <div v-if="shown.length > 0" class="flex flex-wrap gap-1" aria-label="Подсказки">
      <button
        v-for="name in shown"
        :key="name"
        type="button"
        :disabled="disabled"
        class="pressable inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-xs
               text-text-soft hover:border-line-strong hover:text-text"
        @click="add(name)"
      >
        <Plus class="size-3" />
        {{ name }}
      </button>
    </div>

    <p v-if="hint && !error" :id="hintId" class="text-xs text-text-faint">{{ hint }}</p>
    <p v-if="error" :id="errorId" class="text-xs text-danger">{{ error }}</p>
  </div>
</template>
