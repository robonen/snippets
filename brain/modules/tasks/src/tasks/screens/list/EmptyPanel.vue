<script setup lang="ts">
import type { Component } from 'vue';
import { Button } from '@brain/ui';

/**
 * Пустая панель: что здесь будет и как это получить.
 *
 * Поверхность у неё ТА ЖЕ, что у списка, — не пунктирный прямоугольник посреди
 * пустоты. Пунктир говорит «сюда что-то не приехало», сплошная карточка говорит
 * «здесь пока пусто, и это нормальное состояние»; второе — правда, потому что
 * пустая корзина в GTD и есть цель.
 *
 * Лесенка появления здесь уместна: элементов четыре, и видят их по одному разу
 * на корзину — в списке из сорока строк та же лесенка стоила бы полутора секунд.
 */
defineProps<{
  icon: Component;
  title: string;
  description: string;
  /** Подпись кнопки. Без неё панель молчит — но это редкий случай. */
  action?: string;
}>();

const emit = defineEmits<{ act: [] }>();
</script>

<template>
  <div class="flex flex-col items-center gap-3 rounded-card border border-line bg-surface px-6 py-10 text-center">
    <span class="stagger grid size-11 place-items-center rounded-control bg-sunken text-text-faint">
      <component :is="icon" class="size-5" />
    </span>

    <div class="flex flex-col gap-1.5">
      <p class="stagger text-sm font-medium text-text" style="--stagger-index: 1">{{ title }}</p>
      <p
        class="stagger max-w-xs text-xs leading-relaxed text-text-faint"
        style="--stagger-index: 2"
      >
        {{ description }}
      </p>
    </div>

    <Button
      v-if="action"
      class="stagger mt-1"
      tone="primary"
      size="sm"
      style="--stagger-index: 3"
      @click="emit('act')"
    >
      {{ action }}
    </Button>
  </div>
</template>
