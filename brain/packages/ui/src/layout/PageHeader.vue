<script setup lang="ts">
/** Шапка экрана: заголовок, необязательная подпись и место под действия. */
defineProps<{
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <header class="mb-4 flex items-start justify-between gap-3">
    <div class="min-w-0">
      <h1 class="truncate text-xl font-semibold tracking-tight text-text">{{ title }}</h1>
      <p v-if="subtitle" class="mt-0.5 text-[0.8125rem] text-text-faint">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.action" class="flex shrink-0 items-center gap-2">
      <slot name="action" />
    </div>
  </header>
</template>
