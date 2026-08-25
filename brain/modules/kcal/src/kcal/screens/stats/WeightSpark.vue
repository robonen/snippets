<script setup lang="ts">
import { computed } from 'vue';
import { sparkPoints } from '../../entities/stats';

/**
 * Линия веса за последние замеры.
 *
 * Без осей и подписей намеренно: рядом стоит текущий вес цифрой и разница за
 * неделю, а спарклайн отвечает на единственный вопрос — «в какую сторону».
 */
const { values } = defineProps<{ values: readonly number[] }>();

const WIDTH = 100;
const HEIGHT = 30;

const points = computed(() => sparkPoints(values, WIDTH, HEIGHT));
</script>

<template>
  <svg
    v-if="points !== ''"
    class="h-8 w-36"
    :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <polyline
      :points="points"
      fill="none"
      stroke="var(--accent)"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>
