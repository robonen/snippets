<script setup lang="ts">
import { computed } from 'vue';
import { useSpaces } from '@brain/module-kit';
import { dayTitle, todayISO } from '@brain/std';
import { Spinner } from '@brain/ui';
import { useNotes } from '../db/composables';
import { dailyId } from '../db/actions';
import { NOTES_ID } from '../db/models';
import { noteSnippet } from '../entities/note';
import LinkButton from '../screens/LinkButton.vue';

/**
 * Карточка «Заметка дня» на экране «Сегодня».
 *
 * Пространство берётся из реестра ЯВНО: виджет рисует оболочка, а не хост
 * модуля, и `provideSpace` над ним не звучал — `useSpace()` здесь бросил бы.
 *
 * Рамку и заголовок карточке даёт «Сегодня» (`Card` с именем виджета), поэтому
 * внутри только содержимое.
 *
 * Ссылка ведёт на адрес заметки дня, а не на кнопку «завести»: адрес чеканится
 * из даты, поэтому «открыть» и «завести» — одно и то же действие, и человеку
 * незачем знать, была заметка до нажатия или нет.
 */
const space = useSpaces().space(NOTES_ID);
const { list, ready } = useNotes(space);

const date = todayISO();
const note = computed(() => list.value.find(item => item.daily === date));

const subtitle = computed(() => {
  if (note.value === undefined) return 'Заметки на сегодня ещё нет';
  const snippet = noteSnippet(note.value.body);
  return snippet === '' ? 'Пустая — можно писать' : snippet;
});
</script>

<template>
  <div class="flex items-center gap-3">
    <Spinner v-if="!ready" class="size-5 text-text-faint" />

    <template v-else>
      <div class="min-w-0 flex-1">
        <!-- День набран второй гарнитурой: в плитке рядом с чужими виджетами
             это единственное, что отличает её от строки списка настроек. -->
        <p class="text-display truncate text-lg leading-none text-text">{{ dayTitle(date) }}</p>
        <p class="mt-1.5 truncate text-xs text-text-faint">{{ subtitle }}</p>
      </div>

      <LinkButton
        :tone="note === undefined ? 'primary' : 'ghost'"
        :to="{ name: 'notes:note', params: { id: dailyId(date) } }"
      >
        {{ note === undefined ? 'Завести' : 'Открыть' }}
      </LinkButton>
    </template>
  </div>
</template>
