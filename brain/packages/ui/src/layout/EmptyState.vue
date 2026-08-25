<script setup lang="ts">
/**
 * Пустое состояние. Говорит, ЧТО здесь будет и как это получить, — «нет
 * данных» пользователь и так видит.
 */
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <!--
    Единственное место в ките, где уместна лесенка появления. Пустое состояние
    видят редко и по одному разу за экран — это как раз тот случай, когда
    движение можно потратить на приветливость. На списке из сорока строк та же
    лесенка стоила бы полутора секунд ожидания, поэтому её там и нет.

    `--stagger-index` идёт возрастающим: заголовок, пояснение, действие — в том
    порядке, в котором их и читают.
  -->
  <div class="flex flex-col items-center gap-2 rounded-card border border-dashed border-line px-6 py-10 text-center">
    <p class="stagger text-sm font-medium text-text">{{ title }}</p>
    <p
      v-if="description"
      class="stagger max-w-sm text-[0.8125rem] leading-relaxed text-text-faint"
      style="--stagger-index: 1"
    >
      {{ description }}
    </p>
    <div v-if="$slots.action" class="stagger mt-2" style="--stagger-index: 2">
      <slot name="action" />
    </div>
  </div>
</template>
