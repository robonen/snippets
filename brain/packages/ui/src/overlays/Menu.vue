<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@robonen/primitives';
import { Ellipsis } from 'lucide-vue-next';

/**
 * Меню действий над одним объектом: «переименовать», «дублировать», «удалить».
 *
 * Слот `trigger` — это СОДЕРЖИМОЕ кнопки, а не кнопка: саму кнопку рисует
 * примитив, потому что на ней держатся `aria-haspopup`, `aria-expanded` и
 * возврат фокуса после закрытия. Кнопка в кнопке была бы невалидной разметкой,
 * поэтому передавать сюда `Button` нельзя — только иконку или текст.
 *
 * Пункты приходят данными: их поведение должно быть одинаковым везде, иначе
 * `onSelect` где-то отработает до закрытия меню, где-то после, и фокус после
 * удаления улетит в никуда.
 *
 * Разрушающие пункты отделены чертой и покрашены: соседство «дублировать» и
 * «удалить» без разделителя — самая дешёвая в мире потеря данных.
 */
export interface MenuAction {
  readonly id: string;
  readonly title: string;
  readonly icon?: unknown;
  /** Разрушающее действие: отделяется чертой и красится в `danger`. */
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

defineProps<{
  items: readonly MenuAction[];
  /** Чем управляет меню: «Действия над записью». */
  label?: string;
}>();

const open = defineModel<boolean>('open', { default: false });
</script>

<template>
  <DropdownMenuRoot v-model:open="open">
    <DropdownMenuTrigger
      :aria-label="label ?? 'Действия'"
      class="pressable grid size-9 shrink-0 place-items-center rounded-control text-text-faint
             hover:bg-sunken hover:text-text data-[state=open]:bg-sunken data-[state=open]:text-text"
    >
      <slot name="trigger">
        <Ellipsis class="size-5" />
      </slot>
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent
        :side-offset="6"
        align="end"
        class="glass z-50 min-w-44 origin-(--primitives-dropdown-menu-content-transform-origin) rounded-control
               border p-1 shadow-float
               data-[state=open]:animate-[scale-in_var(--duration-menu)_var(--ease-out)]
               data-[state=open]:motion-reduce:animate-[fade-in_var(--duration-hint)_var(--ease-out)]"
      >
        <template v-for="(item, index) in items" :key="item.id">
          <DropdownMenuSeparator
            v-if="item.danger && index > 0 && !items[index - 1]?.danger"
            class="my-1 h-px bg-line"
          />
          <DropdownMenuItem
            :disabled="item.disabled"
            class="flex cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-2 text-sm
                   data-[disabled]:pointer-events-none data-[disabled]:opacity-45
                   data-[highlighted]:outline-none"
            :class="item.danger
              ? 'text-danger data-[highlighted]:bg-danger-soft'
              : 'text-text data-[highlighted]:bg-sunken'"
            @select="item.onSelect()"
          >
            <component :is="item.icon" v-if="item.icon" class="size-4 shrink-0" />
            <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
