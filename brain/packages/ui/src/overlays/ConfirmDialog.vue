<script setup lang="ts">
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from '@robonen/primitives';

/**
 * Подтверждение перед разрушающим действием.
 *
 * Отдельно от {@link Modal} именно потому, что примитив здесь ДРУГОЙ: у
 * `alertdialog` нет крестика, нет закрытия по клику вне, а фокус при открытии
 * встаёт на «Отмену». Всё это — защита от случая, когда диалог всплыл под уже
 * летящим пальцем: у обычной модалки его удалось бы закрыть куда угодно, у
 * этой — только осознанным выбором.
 *
 * Текст должен называть последствие («Удалить 12 записей»), а не спрашивать
 * «Вы уверены?»: на второй вопрос ответ всегда «да», и он ничего не проверяет.
 */
const { confirmLabel = 'Удалить', cancelLabel = 'Отмена', tone = 'danger' } = defineProps<{
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Тон подтверждающей кнопки: разрушающие действия красные, прочие — акцент. */
  tone?: 'danger' | 'accent';
}>();

const emit = defineEmits<{ confirm: [] }>();

const open = defineModel<boolean>('open', { default: false });
</script>

<template>
  <AlertDialogRoot v-model:open="open">
    <AlertDialogPortal>
      <AlertDialogOverlay
        class="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]
               data-[state=open]:animate-[fade-in_var(--duration-hint)_var(--ease-out)]"
      />
      <AlertDialogContent
        class="fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2
               flex-col rounded-sheet border border-line bg-raised p-5 shadow-float
               data-[state=open]:animate-[pop-in_var(--duration-menu)_var(--ease-out)]
               data-[state=open]:motion-reduce:animate-[fade-in_var(--duration-hint)_var(--ease-out)]"
      >
        <AlertDialogTitle class="text-base font-semibold text-text">{{ title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="description" class="mt-1.5 text-[0.8125rem] leading-relaxed text-text-soft">
          {{ description }}
        </AlertDialogDescription>

        <!-- Дополнительное содержимое: поле подтверждения и подобное. -->
        <slot />

        <footer class="mt-5 flex justify-end gap-2">
          <AlertDialogCancel
            class="pressable inline-flex h-10 shrink-0 select-none items-center justify-center rounded-control
                   border border-line bg-surface px-3.5 text-sm font-medium text-text hover:bg-sunken"
          >
            {{ cancelLabel }}
          </AlertDialogCancel>
          <!--
            `capture` здесь несущий, а не украшение. Примитив закрывает диалог
            своим обработчиком на всплытии, а закрытие у вызывающих обнуляет то
            самое, что подтверждают: `open` почти везде вычисляется от полезной
            нагрузки (`removing !== null`), и её сеттер эту нагрузку стирает.
            На всплытии наш `confirm` приходил вторым и заставал уже `null` —
            обработчик выходил на первой строке, и удаление молча не работало.
            Перехват даёт подтверждению сработать ДО закрытия.
          -->
          <AlertDialogAction
            class="pressable inline-flex h-10 shrink-0 select-none items-center justify-center rounded-control
                   px-3.5 text-sm font-medium text-on-accent"
            :class="tone === 'danger' ? 'bg-danger text-white hover:opacity-90' : 'bg-solid text-on-solid hover:opacity-90'"
            @click.capture="emit('confirm')"
          >
            {{ confirmLabel }}
          </AlertDialogAction>
        </footer>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
