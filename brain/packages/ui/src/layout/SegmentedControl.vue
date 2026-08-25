<script setup lang="ts" generic="T extends string">
import { ToggleGroupItem, ToggleGroupRoot } from '@robonen/primitives';

/**
 * Переключатель из нескольких взаимоисключающих вариантов в одной полоске:
 * тема, диапазон графика, режим списка.
 *
 * Отличается от вкладок назначением, а не видом: сегменты меняют ЗНАЧЕНИЕ и не
 * имеют панелей, вкладки меняют ВИДИМУЮ ПАНЕЛЬ. Роли в ARIA у них разные, и
 * подменять одно другим — врать скринридеру.
 */
export interface Segment<Value extends string = string> {
  readonly value: Value;
  readonly label: string;
  /** Иконка; при `iconOnly` она остаётся единственным видимым содержимым. */
  readonly icon?: unknown;
  readonly disabled?: boolean;
}

const { iconOnly = false } = defineProps<{
  /** Чем управляет переключатель: «Тема оформления». */
  label: string;
  segments: ReadonlyArray<Segment<T>>;
  /** Показывать только иконки: подпись уходит в `aria-label` и `title`. */
  iconOnly?: boolean;
}>();

const value = defineModel<T>({ required: true });

// Пустое значение из группы означало бы «не выбрано ничего» — у переключателя
// такого состояния не бывает: повторное нажатие на активный сегмент должно
// оставлять его активным, а не гасить всю полоску.
function onChange(next: unknown): void {
  if (typeof next === 'string' && next !== '') value.value = next as T;
}
</script>

<template>
  <ToggleGroupRoot
    type="single"
    :model-value="value"
    :aria-label="label"
    class="inline-flex rounded-control border border-line bg-surface p-0.5"
    @update:model-value="onChange"
  >
    <ToggleGroupItem
      v-for="segment in segments"
      :key="segment.value"
      :value="segment.value"
      :disabled="segment.disabled"
      :aria-label="iconOnly ? segment.label : undefined"
      :title="iconOnly ? segment.label : undefined"
      class="pressable inline-flex items-center justify-center gap-1.5 rounded-[0.5rem] text-text-faint
             hover:text-text disabled:pointer-events-none disabled:opacity-45
             data-[state=on]:bg-sunken data-[state=on]:text-text"
      :class="iconOnly ? 'size-8' : 'h-8 px-3 text-[0.8125rem] font-medium'"
    >
      <component :is="segment.icon" v-if="segment.icon" class="size-4" />
      <span v-if="!iconOnly">{{ segment.label }}</span>
    </ToggleGroupItem>
  </ToggleGroupRoot>
</template>
