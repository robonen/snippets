<script setup lang="ts">
import { breakpointsTailwind, createReusableTemplate, useBreakpoints } from '@robonen/vue';
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DrawerContent,
  DrawerDescription,
  DrawerHandle,
  DrawerOverlay,
  DrawerPortal,
  DrawerRoot,
  DrawerTitle,
} from '@robonen/primitives';
import { X } from 'lucide-vue-next';

/**
 * Форма поверх содержимого: на телефоне — ящик снизу, на десктопе — модалка.
 *
 * Раньше нижний лист показывался на ЛЮБОЙ ширине, и на десктопе это была чужая
 * идиома: форма уезжала к нижнему краю монитора, подальше от глаз и от курсора,
 * ради удобства большого пальца, которого там нет. Ящик снизу существует потому,
 * что до низа телефона палец дотягивается, а до верха — нет; на мыши это
 * рассуждение не значит ничего.
 *
 * Порог тот же, что у каркаса приложения (`lg`), и это не совпадение: на той же
 * ширине панель сбоку сменяется вкладками снизу. Один порог означает, что
 * приложение не смешивает две идиомы посреди диапазона — либо всё «телефон»,
 * либо всё «десктоп».
 *
 * Тело формы описано ОДИН раз через `createReusableTemplate`: у веток разные
 * примитивы (`Drawer*` против `Dialog*`), но прокрутка, поля и подвал у них
 * общие, и копия неизбежно разъехалась бы при первой же правке.
 */
defineProps<{
  title: string;
  description?: string;
  /** Скрыть заголовок визуально: диалогу он нужен всегда, глазу — не всегда. */
  hideTitle?: boolean;
}>();

const open = defineModel<boolean>('open', { default: false });

const [DefineBody, Body] = createReusableTemplate();

const wide = useBreakpoints(breakpointsTailwind).greaterOrEqual('lg');
</script>

<template>
  <DefineBody>
    <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="shrink-0 border-t border-line px-5 py-3">
      <slot name="footer" />
    </footer>
  </DefineBody>

  <!-- Десктоп: модалка по центру. Растёт из центра, а не от кнопки: открыть
       форму может и горячая клавиша, у которой точки на экране нет. -->
  <DialogRoot v-if="wide" v-model:open="open">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]
               data-[state=open]:animate-[fade-in_var(--duration-hint)_var(--ease-out)]"
      />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg
               -translate-x-1/2 -translate-y-1/2 flex-col rounded-sheet border border-line
               bg-raised shadow-float
               data-[state=open]:animate-[pop-in_var(--duration-menu)_var(--ease-out)]
               data-[state=open]:motion-reduce:animate-[fade-in_var(--duration-hint)_var(--ease-out)]"
      >
        <header class="flex shrink-0 items-start justify-between gap-3 px-5 pt-5 pb-2">
          <div class="min-w-0">
            <DialogTitle :class="hideTitle ? 'sr-only' : 'text-base font-semibold text-text'">
              {{ title }}
            </DialogTitle>
            <DialogDescription v-if="description" class="mt-0.5 text-[0.8125rem] text-text-soft">
              {{ description }}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Закрыть"
            class="pressable -mr-1.5 -mt-0.5 shrink-0 rounded-control p-2 text-text-faint
                   hover:bg-sunken hover:text-text"
          >
            <X class="size-5" />
          </DialogClose>
        </header>

        <Body />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <!-- Телефон: ящик снизу. Крестика нет намеренно — ящик закрывают смахиванием
       вниз, и кнопка в углу конкурировала бы с жестом, который здесь главный. -->
  <DrawerRoot v-else v-model:open="open">
    <DrawerPortal>
      <DrawerOverlay class="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
      <DrawerContent
        class="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] w-full max-w-lg flex-col
               rounded-t-sheet border border-b-0 border-line bg-raised shadow-float
               pb-[env(safe-area-inset-bottom)]"
      >
        <!-- Ручка примитива, а не своя палочка: у неё есть область промаха и
             она участвует в жесте, а не только показывает, что он возможен. -->
        <DrawerHandle class="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-line-strong" />

        <header class="shrink-0 px-5 pt-3 pb-2">
          <DrawerTitle :class="hideTitle ? 'sr-only' : 'text-base font-semibold text-text'">
            {{ title }}
          </DrawerTitle>
          <DrawerDescription v-if="description" class="mt-0.5 text-[0.8125rem] text-text-soft">
            {{ description }}
          </DrawerDescription>
        </header>

        <Body />
      </DrawerContent>
    </DrawerPortal>
  </DrawerRoot>
</template>
