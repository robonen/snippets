<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { ChevronRight } from 'lucide-vue-next';
import { Popover } from '@brain/ui';
import { noteLabel } from '../../entities/note';
import type { Note } from '../../entities/note';

/**
 * Подсказка по `[[`: на какую заметку сослаться.
 *
 * Поповер, а не выпадающий список под курсором: слой у курсора внутри
 * `<textarea>` пришлось бы позиционировать по измерению текста — это отдельная
 * задача с зеркальным элементом, и делать её ради подсказки дорого. Якорь —
 * кнопка над полем, поэтому одно и то же место обслуживает и набор «[[», и
 * человека, который про запись `[[…]]` не знает вовсе.
 *
 * Поле подсказки берёт фокус: примитив ставит его на содержимое при открытии.
 * Это не побочный эффект, а условие работы — иначе стрелками по списку не
 * походить. Вернуть фокус в текст обязан вызывающий, он же знает позицию.
 */
const { notes, query } = defineProps<{
  /** Куда можно сослаться: с заголовком, не архивные, кроме открытой. */
  notes: readonly Note[];
  /** Что уже набрано после `[[`. */
  query: string;
}>();

const emit = defineEmits<{ pick: [title: string] }>();

const open = defineModel<boolean>('open', { default: false });

/** Сколько заметок показываем: подсказка — не список, в ней выбирают одну. */
const LIMIT = 8;

const search = ref('');
const field = useTemplateRef<HTMLInputElement>('field');

const found = computed(() => {
  const needle = search.value.trim().toLowerCase();
  const matched = needle === ''
    ? notes
    : notes.filter(note => note.title.toLowerCase().includes(needle));
  return matched.slice(0, LIMIT);
});

// Запрос уже набран в теле («[[пла»), и повторять его человек не должен.
watch(open, (isOpen) => {
  if (!isOpen) return;
  search.value = query;
  void nextTick(() => field.value?.focus());
});

function pick(note: Note): void {
  emit('pick', note.title);
  open.value = false;
}
</script>

<template>
  <Popover v-model:open="open" align="end">
    <template #trigger>
      <ChevronRight class="size-4 text-text-faint" />
      Ссылка
    </template>

    <div class="flex flex-col gap-2">
      <!-- Своё поле, а не `TextField`: подписи над строкой в подсказке нет
           места, а имя ей всё равно нужно — оно ушло в `aria-label`. -->
      <input
        ref="field"
        v-model="search"
        type="search"
        aria-label="Заголовок заметки"
        placeholder="Заголовок заметки"
        class="h-9 w-full rounded-control border border-line bg-surface px-3 text-sm text-text
               transition-colors placeholder:text-text-faint hover:border-line-strong"
      >

      <p v-if="found.length === 0" class="px-1 py-1.5 text-[0.8125rem] leading-relaxed text-text-faint">
        Ничего не нашлось. Ссылаться можно и на будущую заметку — напишите
        [[её заголовок]], она найдёт себя сама.
      </p>

      <ul v-else class="-mx-1 flex max-h-56 flex-col overflow-y-auto">
        <li v-for="note in found" :key="note.id">
          <button
            type="button"
            class="pressable hoverable w-full truncate rounded-control px-2 py-1.5 text-left text-sm
                   text-text"
            @click="pick(note)"
          >
            {{ noteLabel(note) }}
          </button>
        </li>
      </ul>
    </div>
  </Popover>
</template>
