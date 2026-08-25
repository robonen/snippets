<script setup lang="ts">
import { computed } from 'vue';
import { Bookmark, CalendarDays, Inbox, Plus, X } from 'lucide-vue-next';
import { Badge, Menu } from '@brain/ui';
import type { MenuAction } from '@brain/ui';
import { noteLabel, noteSnippet } from '../../entities/note';
import type { Note } from '../../entities/note';
import { fmtWhen } from '../../lib/format';

/**
 * Строка рельса: заголовок с датой, под ними — начало текста, теги — если есть
 * куда.
 *
 * Строка, а не карточка. Карточка вокруг каждой заметки давала решётку
 * одинаковых прямоугольников, в которой ни одна заметка не выделялась; на полке
 * с разделителями глаз читает содержимое, а не рамки.
 *
 * Два ЭТАЖА, а не одна строка: в колонке 21 rem заголовок, продолженный
 * сниппетом, съедал сниппет целиком — до него не доходило ни одного знака.
 * Оба этажа обрезаются, поэтому высота строки по-прежнему не зависит от того,
 * что в заметке написано.
 *
 * Строка — ССЫЛКА, а не кнопка: у заметки есть адрес, и переход по списку
 * обязан уметь «открыть в новой вкладке» и «скопировать адрес». Открытая
 * заметка помечена полоской слева — в мастер-детали список остаётся на виду, и
 * не показать в нём, что именно открыто, значит потерять место.
 *
 * Меню — СОСЕДОМ строки, а не внутри неё: строка сама является целью нажатия, и
 * кнопка внутри ссылки была бы невалидной разметкой, а нажатие на «Удалить»
 * заодно открывало бы заметку.
 *
 * Действия уходят наверх событиями, а не делаются здесь: удаление и архив
 * показывают сообщение с «Отменить», и владеть этим сообщением должен экран —
 * строка к моменту показа уже исчезла из списка.
 */
const { note, active = false } = defineProps<{
  note: Note;
  /** Эта заметка открыта справа. */
  active?: boolean;
}>();

const emit = defineEmits<{
  pin: [];
  archive: [];
  duplicate: [];
  remove: [];
}>();

/** Сколько тегов помещается, не тесня сниппет. Остальные считаются числом. */
const TAGS_SHOWN = 2;

const label = computed(() => noteLabel(note));
const snippet = computed(() => noteSnippet(note.body));
const shown = computed(() => note.tags.slice(0, TAGS_SHOWN));
const hidden = computed(() => note.tags.length - shown.value.length);

const items = computed<MenuAction[]>(() => [
  {
    id: 'pin',
    title: note.pinned ? 'Открепить' : 'Закрепить',
    icon: Bookmark,
    onSelect: () => emit('pin'),
  },
  {
    id: 'duplicate',
    title: 'Дублировать',
    icon: Plus,
    onSelect: () => emit('duplicate'),
  },
  {
    id: 'archive',
    title: note.archived ? 'Вернуть из архива' : 'В архив',
    icon: Inbox,
    onSelect: () => emit('archive'),
  },
  {
    id: 'remove',
    title: 'Удалить',
    icon: X,
    danger: true,
    onSelect: () => emit('remove'),
  },
]);
</script>

<template>
  <li class="@container flex items-center gap-1 pr-2">
    <!-- Обводка фокуса уходит ВНУТРЬ строки: полка обрезает всё, что выходит за
         её скруглённый край, и обводка снаружи была бы срезана до невидимости. -->
    <RouterLink
      :to="{ name: 'notes:note', params: { id: note.id } }"
      class="pressable hoverable flex min-w-0 flex-1 flex-col gap-0.5 border-l-2 py-2 pr-1 pl-2.5
             focus-visible:outline-offset-[-2px]"
      :class="active ? 'border-accent bg-sunken' : 'border-transparent'"
    >
      <span class="flex min-w-0 items-center gap-2">
        <!-- Значок только у заметки дня: одинаковая иконка на каждой строке
             различает строки не лучше, чем их одинаковый цвет. -->
        <CalendarDays v-if="note.daily !== undefined" class="size-3.5 shrink-0 text-text-faint" />

        <span class="min-w-0 flex-1 truncate text-sm text-text">{{ label }}</span>
        <span class="tnum shrink-0 text-xs text-text-faint">{{ fmtWhen(note.updatedAt) }}</span>
      </span>

      <!-- Второй этаж держит высоту даже пустым: без этого строки заметок без
           текста были бы ниже соседних, и список пошёл бы волной. -->
      <span class="flex min-h-4 min-w-0 items-center gap-2">
        <span class="min-w-0 flex-1 truncate text-xs text-text-faint">{{ snippet }}</span>

        <!-- Теги — только когда колонка ШИРЕ РЕЛЬСА (21 rem, отсюда порог в 22).
             В самом рельсе они отбирают ширину у сниппета, ради которого строка
             и стала двухэтажной; там, где список занимает экран целиком, места
             хватает на всё. Условие по контейнеру, а не по окну: рельс шире
             окна не станет никогда. -->
        <span v-if="note.tags.length > 0" class="hidden shrink-0 items-center gap-1 @min-[22rem]:flex">
          <Badge v-for="tag in shown" :key="tag">{{ `#${tag}` }}</Badge>
          <span v-if="hidden > 0" class="tnum text-xs text-text-faint">{{ `+${hidden}` }}</span>
        </span>
      </span>
    </RouterLink>

    <Menu :items="items" :label="`Действия над заметкой «${label}»`" />
  </li>
</template>
