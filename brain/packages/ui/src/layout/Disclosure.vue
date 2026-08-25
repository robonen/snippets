<script setup lang="ts">
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from '@robonen/primitives';
import { ChevronDown } from 'lucide-vue-next';

/**
 * Сворачиваемая секция: «Подробнее», «Дополнительные поля», «Заметка к записи».
 *
 * Смысл прятать — не в экономии пикселей, а в том, что свёрнутое содержимое не
 * читается глазом при беглом просмотре. Поэтому в заголовке должно стоять то,
 * что внутри, а не «Ещё».
 *
 * `unmountOnHide` выключен намеренно: примитив тогда оставляет содержимое в DOM
 * с `hidden="until-found"`, и поиск по странице (Ctrl+F) находит текст внутри
 * закрытой секции, сам её раскрывая. С размонтированием этот текст для поиска
 * просто не существовал бы.
 */
defineProps<{
  title: string;
  /** Правая приписка в заголовке: счётчик, краткое значение. */
  hint?: string;
  disabled?: boolean;
}>();

const open = defineModel<boolean>('open', { default: false });
</script>

<template>
  <CollapsibleRoot
    v-model:open="open"
    :disabled="disabled"
    :unmount-on-hide="false"
    class="rounded-card border border-line bg-surface"
  >
    <CollapsibleTrigger
      class="pressable hoverable group flex w-full items-center gap-2 rounded-card px-3.5 py-3 text-left
             data-[disabled]:pointer-events-none data-[disabled]:opacity-45"
    >
      <span class="min-w-0 flex-1 truncate text-sm font-medium text-text">{{ title }}</span>
      <span v-if="hint" class="tnum shrink-0 text-xs text-text-faint">{{ hint }}</span>
      <ChevronDown
        class="size-4 shrink-0 text-text-faint transition-transform duration-(--duration-menu) ease-(--ease-in-out)
               group-data-[state=open]:rotate-180 motion-reduce:transition-none"
      />
    </CollapsibleTrigger>

    <CollapsibleContent
      class="overflow-hidden px-3.5 pb-3.5
             data-[state=open]:animate-[sheet-up_var(--duration-menu)_var(--ease-out)]
             data-[state=open]:motion-reduce:animate-[fade-in_var(--duration-hint)_var(--ease-out)]"
    >
      <slot />
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
