<script setup lang="ts">
import { computed } from 'vue'
import './shiki-host.css'

// HTML приходит из импорта `*?shiki` — подсветка уже сделана на этапе сборки.
// Этот компонент не тянет ни Shiki, ни грамматики в клиентский бандл.
const props = withDefaults(
  defineProps<{
    html: string
    lineNumbers?: boolean
    startLine?: number
  }>(),
  { lineNumbers: false, startLine: 1 },
);

const gutterStyle = computed(() => {
  const lines = props.html.match(/class="line"/g)?.length ?? 1;
  const total = props.startLine + lines - 1;
  return {
    '--shiki-line-start': String(props.startLine),
    '--shiki-gutter-width': `${String(total).length}ch`,
  };
});
</script>

<template>
  <div
    class="shiki-host"
    :data-line-numbers="lineNumbers ? '' : undefined"
    :style="gutterStyle"
    v-html="html"
  />
</template>
