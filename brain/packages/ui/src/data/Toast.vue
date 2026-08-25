<script setup lang="ts">
import {
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
} from '@robonen/primitives';
import { useDocumentVisibility } from '@robonen/vue';
import { X } from 'lucide-vue-next';
import { useToast } from './toast';
import type { ToastEntry } from './toast';

/**
 * Провайдер и вьюпорт всплывающих сообщений. Монтируется ОДИН раз в оболочке,
 * очередь берётся из {@link useToast}.
 *
 * Примитив держит здесь всё, что делает тост доступным, а не просто заметным:
 * `aria-live` нужной вежливости, паузу таймера при наведении и при фокусе,
 * горячую клавишу F8, которая переносит фокус во вьюпорт, и порядок обхода —
 * из тоста фокус возвращается туда, откуда пришёл. Написать это заново и не
 * забыть половину — ровно та работа, ради ухода от которой кит стоит на
 * примитивах.
 */
const { items, dismiss } = useToast();

/**
 * Единственное, чего примитив не знает: что на вкладку сейчас не смотрят.
 * Пять секунд «Запись удалена. Отменить?» истекают одинаково — и когда человек
 * читает сообщение, и когда он ушёл в соседнюю вкладку. Второе означает, что
 * отмену он не увидит вовсе.
 *
 * Ставится это через ПУБЛИЧНЫЙ `duration`, а не через внутренний канал паузы
 * примитива: у того пауза считает остаток от времени старта, и повторный вызов
 * поверх уже приостановленного таймера (наведение + уход со вкладки) обнулил бы
 * остаток — тост завис бы на экране навсегда. `Infinity` таймер честно
 * останавливает, а по возвращении отсчёт начинается заново, целиком: вернувшись,
 * сообщение читают с начала, а не с того места, где его бросили.
 */
const visibility = useDocumentVisibility();

const TONES: Record<NonNullable<ToastEntry['tone']>, string> = {
  neutral: 'bg-line-strong',
  positive: 'bg-positive',
  danger: 'bg-danger',
};

// Действие обязано снимать тост само: «Отменить» на висящем сообщении читается
// как «отмена не сработала», и второе нажатие отменит уже что-то другое.
function runAction(entry: ToastEntry): void {
  entry.action?.onAction();
  dismiss(entry.id);
}
</script>

<template>
  <ToastProvider label="Уведомления" swipe-direction="right">
    <!--
      Появление сделано ПЕРЕХОДОМ (`starting:` — это `@starting-style`), а не
      keyframes, и это тот самый случай, ради которого разница существует.
      Тосты приходят пачками и внахлёст: keyframes на каждом новом сообщении
      стартуют с нуля и дёргают уже едущий стек, переход же перенацеливается с
      текущей точки и остаётся гладким.
    -->
    <ToastRoot
      v-for="entry in items"
      :key="entry.id"
      :duration="visibility === 'visible' ? entry.duration : Number.POSITIVE_INFINITY"
      :type="entry.action ? 'foreground' : 'background'"
      to-viewport
      class="glass pointer-events-auto flex items-start gap-3 overflow-hidden rounded-card border py-3
             pr-2 pl-0 shadow-float
             transition-[opacity,translate] duration-(--duration-menu) ease-out
             starting:translate-y-3 starting:opacity-0
             data-[swipe=move]:translate-x-[var(--primitives-toast-swipe-move-x)]
             data-[swipe=move]:transition-none
             data-[swipe=cancel]:translate-x-0
             motion-reduce:transition-[opacity] motion-reduce:starting:translate-y-0"
      @update:open="(open: boolean) => { if (!open) dismiss(entry.id); }"
    >
      <span aria-hidden="true" class="w-1 shrink-0 self-stretch rounded-r-full" :class="TONES[entry.tone ?? 'neutral']" />

      <div class="min-w-0 flex-1">
        <ToastTitle class="text-sm font-medium text-text">{{ entry.title }}</ToastTitle>
        <ToastDescription v-if="entry.description" class="mt-0.5 text-xs leading-relaxed text-text-soft">
          {{ entry.description }}
        </ToastDescription>
      </div>

      <ToastAction
        v-if="entry.action"
        :alt-text="entry.action.altText"
        class="pressable shrink-0 self-center rounded-control px-2.5 py-1.5 text-[0.8125rem] font-medium
               text-accent hover:bg-accent-soft"
        @click="runAction(entry)"
      >
        {{ entry.action.label }}
      </ToastAction>

      <ToastClose
        aria-label="Закрыть"
        class="pressable shrink-0 self-start rounded-control p-1.5 text-text-faint
               hover:bg-sunken hover:text-text"
      >
        <X class="size-4" />
      </ToastClose>
    </ToastRoot>

    <!-- `pointer-events-none` на самом вьюпорте: пустая полоса поверх экрана
         иначе перехватывала бы нажатия по списку под ней. -->
    <ToastViewport
      class="pointer-events-none fixed inset-x-0 bottom-0 z-[60] mx-auto flex w-full max-w-md list-none flex-col
             gap-2 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
    />
  </ToastProvider>
</template>
