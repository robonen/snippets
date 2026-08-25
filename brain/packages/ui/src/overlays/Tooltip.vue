<script setup lang="ts">
import {
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipRoot,
  TooltipTrigger,
} from '@robonen/primitives';

/**
 * Короткое пояснение к элементу по наведению и по фокусу с клавиатуры.
 *
 * Требует {@link TooltipProvider} выше по дереву — примитив без него бросает
 * исключение. Это не недосмотр: пауза перед показом и общее окно «без паузы»
 * имеют смысл только как общие для всего приложения.
 *
 * Подсказка не заменяет подпись. Всё, что в ней написано, должно быть
 * необязательным: она недоступна с сенсорного экрана, где нет ни наведения, ни
 * долгого фокуса. Название кнопки-иконки — это `aria-label`, а не подсказка.
 */
defineProps<{
  text: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  arrow?: boolean;
}>();
</script>

<template>
  <TooltipRoot>
    <!-- `as="template"` — подсказка НЕ создаёт свой элемент, а надевается на
         содержимое слота. Обёртка вокруг кнопки дала бы кнопку в кнопке, а
         обёртка вокруг иконки — элемент, на который нельзя навести фокус, и
         подсказка исчезла бы для клавиатуры. Отсюда требование к слоту: ровно
         один корневой элемент, и он должен уметь принимать фокус. -->
    <TooltipTrigger as="template">
      <slot />
    </TooltipTrigger>

    <TooltipPortal>
      <!-- Анимируется только `delayed-open` — первая подсказка после паузы.
           `instant-open` (вторая и следующие в том же окне «без паузы») не
           анимируется намеренно: провайдер снял задержку ради того, чтобы
           соседняя иконка подписывалась мгновенно, и вернуть её анимацией
           значило бы отменить единственный смысл этого окна. -->
      <TooltipContent
        :side="side ?? 'top'"
        :align="align ?? 'center'"
        :side-offset="6"
        :collision-padding="8"
        class="z-50 max-w-64 origin-(--tooltip-content-transform-origin) rounded-control bg-text px-2.5
               py-1.5 text-xs leading-snug text-surface
               data-[state=delayed-open]:animate-[scale-in_var(--duration-hint)_var(--ease-out)]
               data-[state=delayed-open]:motion-reduce:animate-[fade-in_var(--duration-hint)_var(--ease-out)]"
      >
        {{ text }}
        <TooltipArrow v-if="arrow" class="fill-text" :width="10" :height="5" />
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
