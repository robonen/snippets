<script setup lang="ts">
import { useWritekitContext } from '@robonen/writekit';

/**
 * Мостик к контексту редактора. `useWritekitContext()` работает только ПОД
 * `WritekitRoot`, а фокус и каретка нужны экрану снаружи — после подсказки
 * `[[…]]` курсор обязан вернуться в текст. Компонент ничего не рисует: он
 * лишь отдаёт наверх `focusBlock` из контекста.
 */
const emit = defineEmits<{
  ready: [focus: (blockId: string, offset: number | 'start' | 'end') => void];
}>();

const context = useWritekitContext();
emit('ready', context.focusBlock);
</script>

<template>
  <slot />
</template>
