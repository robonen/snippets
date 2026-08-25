<script setup lang="ts">
import {
  PopoverArrow,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from '@robonen/primitives';

/**
 * Всплывающий слой у элемента: фильтр, выбор цвета, короткая справка с
 * кнопкой.
 *
 * От {@link Tooltip} отличается не размером, а тем, что внутри МОЖНО
 * взаимодействовать: подсказка исчезает при уходе курсора, поповер — нет.
 * Поэтому и открывается он нажатием, а не наведением.
 *
 * `modal` по умолчанию выключен: ловушка фокуса на выборе фильтра мешала бы
 * прокрутить список под ним. Включать её стоит там, где слой заменяет диалог.
 *
 * Слот `trigger` — СОДЕРЖИМОЕ кнопки, а не кнопка: `aria-expanded` и возврат
 * фокуса примитив вешает на свой элемент, а кнопка в кнопке невалидна.
 */
defineProps<{
  /** Сторона якоря, у которой слой пытается встать. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Ловушка фокуса и блокировка внешних нажатий. */
  modal?: boolean;
  /** Уголок к якорю: нужен, когда слой далеко ушёл при обходе края экрана. */
  arrow?: boolean;
}>();

const open = defineModel<boolean>('open', { default: false });
</script>

<template>
  <PopoverRoot v-model:open="open" :modal="modal">
    <PopoverTrigger
      class="pressable inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-control border
             border-line bg-surface px-3.5 text-sm font-medium text-text hover:bg-sunken
             data-[state=open]:bg-sunken"
    >
      <slot name="trigger" />
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        :side="side ?? 'bottom'"
        :align="align ?? 'center'"
        :side-offset="8"
        :collision-padding="12"
        class="glass z-50 max-w-[min(20rem,calc(100vw-2rem))] origin-(--popover-content-transform-origin)
               rounded-card border p-3 shadow-float
               data-[state=open]:animate-[scale-in_var(--duration-menu)_var(--ease-out)]
               data-[state=open]:motion-reduce:animate-[fade-in_var(--duration-hint)_var(--ease-out)]"
      >
        <slot />
        <PopoverArrow v-if="arrow" class="fill-glass" :width="12" :height="6" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
