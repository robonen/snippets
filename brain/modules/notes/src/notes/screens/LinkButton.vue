<script setup lang="ts">
/**
 * Ссылка, одетая кнопкой.
 *
 * Почему не `Button` из кита: он рисует `<button>`, а вложить кнопку в `<a>`
 * нельзя — интерактивное внутри интерактивного ломает и разметку, и обход с
 * клавиатуры.
 *
 * Почему вообще ссылка, когда у экранов есть `router.push`: переход между
 * заметками обязан уметь «открыть в новой вкладке» и «скопировать адрес», а
 * кнопка этого не умеет. `router.push` остаётся там, где нажатие сначала
 * ПИШЕТ, а потом ведёт, — по кнопке-ссылке порядок этих двух шагов не
 * гарантирован.
 *
 * `to` описан шире, чем `RouteLocationRaw`: тип живёт в `vue-router`, и
 * повторять его своими руками значит держать копию чужого контракта. Проверяет
 * цель роутер, а не мы.
 */
const { tone = 'primary', size = 'sm' } = defineProps<{
  to: string | Record<string, unknown>;
  tone?: 'primary' | 'ghost';
  size?: 'sm' | 'md' | 'icon';
}>();

const TONES = {
  primary: 'bg-solid text-on-solid hover:opacity-90',
  ghost: 'text-text-soft hover:bg-sunken hover:text-text',
};

const SIZES = {
  sm: 'h-8 gap-1.5 px-2.5 text-[0.8125rem]',
  md: 'h-10 gap-2 px-3.5 text-sm',
  // Без подписи — в шапке рельса на подпись нет ширины. Имя такой ссылки живёт
  // в `aria-label` и `title`: невидимая глазу подпись всё равно обязана быть.
  icon: 'size-8',
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
