<script setup lang="ts">
/**
 * Поверхность с содержимым. Разделение несёт линия и цвет поверхности, а не
 * тень: в тёмной теме тени почти не читаются, и опора на них означала бы, что
 * иерархия видна только в светлой.
 */
defineProps<{
  title?: string;
  /** Плотный вариант — для списков карточек на «Сегодня». */
  compact?: boolean;
}>();
</script>

<template>
  <section
    class="rounded-card border border-line bg-surface"
    :class="compact ? 'p-3.5' : 'p-4'"
  >
    <header v-if="title || $slots.action" class="mb-3 flex items-center justify-between gap-3">
      <h2 v-if="title" class="text-sm font-medium text-text-soft">{{ title }}</h2>
      <slot name="action" />
    </header>
    <slot />
  </section>
</template>
