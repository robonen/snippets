<script setup lang="ts">
import { computed } from 'vue';
import { noteStats } from '../../entities/note';
import type { NoteBody } from '../../entities/body';
import type { Note } from '../../entities/note';
import { fmtDate, fmtWords } from '../../lib/format';

/**
 * Сведения о заметке одной тонкой строкой под заголовком.
 *
 * Не карточка и не раскрывашка: это выходные данные текста, а не отдельный
 * блок экрана. Раскрывашка со счётчиками занимала место всегда и требовала
 * нажатия ради трёх чисел, которые целиком помещаются в строку подписи.
 */
const { note, body } = defineProps<{
  note: Note;
  /** Тело из формы, а не из снимка: счётчик обязан идти за набором. */
  body: NoteBody;
}>();

const parts = computed(() => [
  `Создано ${fmtDate(note.createdAt)}`,
  `Изменено ${fmtDate(note.updatedAt)}`,
  fmtWords(noteStats(body).words),
]);
</script>

<template>
  <p class="tnum flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-faint">
    <template v-for="(part, index) in parts" :key="part">
      <span v-if="index > 0" aria-hidden="true" class="size-1 rounded-full bg-line-strong" />
      <span>{{ part }}</span>
    </template>
  </p>
</template>
