<script setup lang="ts">
import { computed } from 'vue';
import { useToday } from '@brain/module-kit';
import { CalendarDays } from 'lucide-vue-next';
import { EmptyState, Page, Spinner } from '@brain/ui';
import { useNotes } from '../db/composables';
import { dailyId } from '../db/actions';
import LinkButton from './LinkButton.vue';
import NotesSummary from './list/NotesSummary.vue';

/**
 * Правая часть, пока ни одна заметка не открыта.
 *
 * Экран существует потому, что у мастер-детали адрес `/notes` — это законное
 * состояние «список открыт, заметка не выбрана», и пустая половина экрана
 * читалась бы как незагрузившаяся страница.
 *
 * Сюда же переехала ОПОРА модуля — сводка крупными числами. В рельсе 21 rem она
 * отбирала у списка первый экран; здесь ей есть место, и ритм «крупное →
 * плотное» держится по горизонтали: числа справа, плотный список слева. На
 * узком экране этой половины не видно вовсе, поэтому там сводка остаётся в
 * списке (см. `NotesScreen`).
 */
const { list, ready } = useNotes();

/**
 * Дата — реактивная: вкладку с заметками держат открытой сутками, и ссылка
 * «заметка дня», посчитанная один раз при монтировании, после полуночи вела бы
 * во вчера.
 */
const today = useToday();
const dailyNoteId = computed(() => dailyId(today.value));

/**
 * Пустая коллекция и «просто ничего не выбрано» — разные состояния, и обещать
 * во втором «здесь будут заметки» значит не заметить полсотни уже написанных.
 * Кнопки «Новая» здесь нет намеренно: она в шапке списка, в двадцати пикселях
 * левее, и вторая такая же учила бы, что их две разных.
 */
const copy = computed(() => (list.value.length === 0
  ? {
      title: 'Пока ни одной заметки',
      description: 'Заведите первую кнопкой «Новая» слева или из палитры по ⌘K — заготовки на выбор: пустая, заметка дня, встреча, идея.',
    }
  : {
      title: 'Выберите заметку',
      description: 'Слева весь список: заголовок, начало текста и когда трогали. У каждой заметки свой адрес, поэтому её можно открыть в новой вкладке и сослаться на неё из другой заметки — [[её заголовок]].',
    }));
</script>

<template>
  <Page width="reading">
    <div v-if="!ready" class="flex justify-center py-16">
      <Spinner class="size-6 text-text-faint" />
    </div>

    <div v-else class="flex flex-col gap-4">
      <NotesSummary v-if="list.length > 0" :notes="list" />

      <EmptyState :title="copy.title" :description="copy.description">
        <template #action>
          <LinkButton size="md" tone="ghost" :to="{ name: 'notes:note', params: { id: dailyNoteId } }">
            <CalendarDays class="size-4" />
            Заметка дня
          </LinkButton>
        </template>
      </EmptyState>
    </div>
  </Page>
</template>
