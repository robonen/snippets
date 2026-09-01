<script setup lang="ts">
/**
 * Ссылка, одетая кнопкой.
 *
 * `Button` из кита рисует `<button>`, а вложить кнопку в `<a>` нельзя —
 * интерактивное внутри интерактивного ломает и разметку, и обход с клавиатуры.
 * Ссылка же обязана уметь «открыть в новой вкладке» и «скопировать адрес».
 *
 * `to` описан шире, чем `RouteLocationRaw`: тип живёт в `vue-router`, и
 * повторять его своими руками значит держать копию чужого контракта.
 */
const { tone = 'primary', size = 'sm' } = defineProps<{
  to: string | Record<string, unknown>;
  tone?: 'primary' | 'ghost';
  size?: 'sm' | 'md';
}>();

const TONES = {
  primary: 'bg-solid text-on-solid hover:opacity-90',
  ghost: 'text-text-soft hover:bg-sunken hover:text-text',
};

const SIZES = {
  sm: 'h-8 gap-1.5 px-2.5 text-[0.8125rem]',
  md: 'h-10 gap-2 px-3.5 text-sm',
};
</script>

<template>
  <RouterLink
    :to="to"
    class="inline-flex shrink-0 select-none items-center justify-center rounded-control font-medium
           transition-colors"
    :class="[TONES[tone], SIZES[size]]"
  >
    <slot />
  </RouterLink>
</template>
