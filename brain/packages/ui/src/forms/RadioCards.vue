<script setup lang="ts" generic="T extends string">
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from '@robonen/primitives';

/**
 * Взаимоисключающий выбор карточками: пол, цель, уровень активности.
 *
 * Карточка вместо строки с точкой — потому что у таких вариантов есть
 * ПОЯСНЕНИЕ, и его надо читать до выбора, а не после. Целью нажатия остаётся
 * вся карточка: попадать в шестимиллиметровую точку пальцем — не выбор.
 *
 * Стрелки, Home/End, единая остановка Tab на группу и `role="radiogroup"` —
 * на примитиве. Радиогруппа принципиально не ходит по Tab между вариантами:
 * иначе перебор десяти целей означал бы десять шагов мимо кнопки «Сохранить».
 */
export interface RadioCard<Value extends string = string> {
  readonly value: Value;
  readonly title: string;
  /** Строка под заголовком: чем этот вариант отличается от соседнего. */
  readonly description?: string;
  readonly disabled?: boolean;
}

defineProps<{
  /** Что выбирается: «Уровень активности». */
  label: string;
  cards: ReadonlyArray<RadioCard<T>>;
  disabled?: boolean;
}>();

const value = defineModel<T | undefined>();

function onChange(next: unknown): void {
  if (typeof next === 'string') value.value = next as T;
}
</script>

<template>
  <RadioGroupRoot
    :model-value="value"
    :disabled="disabled"
    :aria-label="label"
    class="grid gap-2"
    @update:model-value="onChange"
  >
    <RadioGroupItem
      v-for="card in cards"
      :key="card.value"
      :value="card.value"
      :disabled="card.disabled"
      class="pressable group flex w-full items-start gap-3 rounded-card border bg-surface p-3.5 text-left
             data-[disabled]:pointer-events-none data-[disabled]:opacity-45
             data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft
             data-[state=unchecked]:border-line data-[state=unchecked]:hover:border-line-strong"
    >
      <span
        class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 border-line-strong
               transition-colors group-data-[state=checked]:border-accent"
      >
        <RadioGroupIndicator class="block size-2.5 rounded-full bg-accent" />
      </span>

      <span class="min-w-0">
        <span class="block text-sm font-medium text-text">{{ card.title }}</span>
        <span v-if="card.description" class="mt-0.5 block text-xs leading-relaxed text-text-faint">
          {{ card.description }}
        </span>
      </span>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
