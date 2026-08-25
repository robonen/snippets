<script setup lang="ts">
import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandRoot,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from '@robonen/primitives';

/**
 * Палитра: поле ввода и сгруппированный список действий.
 *
 * Компонент не знает, ОТКУДА берутся группы — это работа оболочки. Здесь
 * только поведение (фильтрация, стрелки, Enter, ловушка фокуса — всё на
 * примитивах) и оформление. Разделение нужно ради слоёв: если бы палитра
 * ходила в реестр модулей сама, кит перестал бы быть общим.
 */
export interface PaletteItem {
  readonly id: string;
  readonly title: string;
  /** Правая приписка: имя модуля, тип, дата. */
  readonly hint?: string;
  /** Дополнительные слова для нечёткого поиска. */
  readonly keywords?: string;
  /** Выделить цветом действия — для «захватить», «создать». */
  readonly accent?: boolean;
  readonly onSelect: () => void;
}

export interface PaletteGroup {
  readonly id: string;
  readonly title?: string;
  readonly items: readonly PaletteItem[];
}

defineProps<{
  groups: readonly PaletteGroup[];
  placeholder?: string;
  /** Что показать, когда фильтр ничего не оставил. */
  emptyText?: string;
}>();

const open = defineModel<boolean>('open', { default: false });
const query = defineModel<string>('query', { default: '' });
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]
               data-[state=open]:animate-[fade-in_var(--duration-press)_var(--ease-out)]"
      />
      <!--
        Палитра НЕ анимируется, и это решение, а не пропуск.

        Её открывают с клавиатуры и по многу раз за день — а любая анимация на
        такой частоте перестаёт читаться как изящество и начинает читаться как
        задержка. Здесь пользователь уже набирает запрос в тот момент, когда
        слой ещё ехал бы; выигранные 200 мс он почувствует, а отсутствие
        появления — нет.

        Затемнению короткое проявление всё же оставлено: чёрный кадр без него
        бьёт по глазам сильнее, чем сама пауза.
      -->
      <DialogContent
        class="glass fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2
               overflow-hidden rounded-sheet border shadow-float"
      >
        <DialogTitle class="sr-only">Палитра команд</DialogTitle>
        <DialogDescription class="sr-only">
          Поиск, действия модулей и переходы по разделам
        </DialogDescription>

        <CommandRoot>
          <CommandInput
            v-model="query"
            :placeholder="placeholder ?? 'Команда, переход или поиск…'"
            class="h-12 w-full border-b border-line bg-transparent px-4 text-sm text-text
                   outline-none placeholder:text-text-faint"
          />

          <CommandList class="max-h-[50vh] overflow-y-auto p-1.5">
            <CommandEmpty class="px-3 py-6 text-center text-sm text-text-faint">
              {{ emptyText ?? 'Ничего не нашлось' }}
            </CommandEmpty>

            <CommandGroup v-for="group in groups" :key="group.id">
              <p v-if="group.title" class="px-2.5 pt-2 pb-1 text-xs text-text-faint">
                {{ group.title }}
              </p>
              <CommandItem
                v-for="item in group.items"
                :key="item.id"
                :value="item.keywords ? `${item.title} ${item.keywords}` : item.title"
                class="pressable flex cursor-pointer items-center gap-2 rounded-control px-2.5 py-2 text-sm
                       data-[highlighted]:bg-sunken"
                :class="item.accent ? 'text-accent' : 'text-text'"
                @select="item.onSelect()"
              >
                <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
                <span v-if="item.hint" class="shrink-0 text-xs text-text-faint">{{ item.hint }}</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandRoot>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
