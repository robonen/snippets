<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { debounce } from '@robonen/stdlib';
import { dayTitle } from '@brain/std';
import { BookOpen, Bookmark, ChevronLeft, Inbox, Plus, X } from 'lucide-vue-next';
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  Menu,
  Page,
  Spinner,
  Toolbar,
  useToast,
} from '@brain/ui';
import type { MenuAction, ToolbarAction } from '@brain/ui';
import { useActions, useNotes } from '../../db/composables';
import { blankNote } from '../../db/actions';
import NoteEditor from '../../editor/NoteEditor.vue';
import { noteToMarkdown } from '../../entities/export';
import { mentionsOf } from '../../entities/mentions';
import { noteLabel, sameContent } from '../../entities/note';
import type { Note } from '../../entities/note';
import { countTags } from '../../entities/tags';
import { copyText } from '../../lib/download';
import LinkButton from '../LinkButton.vue';
import MentionsPanel from './MentionsPanel.vue';
import NoteMeta from './NoteMeta.vue';
import TagsField from './TagsField.vue';

/**
 * Экран заметки: заголовок, теги, тело, упоминания и сведения.
 *
 * Экран открывается ПО АДРЕСУ, и документа по нему может ещё не быть — так
 * заводятся и новая заметка, и заметка дня. Пока в форму не написали ни буквы,
 * в ленде ничего не появляется: заглянуть по адресу и уйти — не создать
 * заметку.
 *
 * Кнопки «Сохранить» нет и не будет: запись в ленд локальная и настоящая,
 * откатывать нечего, а значит и подтверждать нечего. Отменяются не записи, а
 * ПОТЕРИ — удаление и архив показывают сообщение с «Отменить».
 *
 * Тело редактирует `editor/NoteEditor.vue` (writekit); наружу он отдаёт ту же
 * строку markdown, что и прежнее поле, поэтому запись, поиск, упоминания и
 * выгрузка не заметили замены.
 */
const { id } = defineProps<{ id: string }>();

const { list, ready } = useNotes();
const actions = useActions();
const toast = useToast();

const note = computed(() => list.value.find(item => item.id === id));

/** Что показываем: заметку из ленда или заготовку по адресу. */
const base = computed<Note>(() => note.value ?? blankNote(id));

const title = ref('');
const body = ref('');
const tags = ref<readonly string[]>([]);

/** Адрес, форму которого уже наполнили. */
const filled = ref<string | null>(null);

const confirming = ref(false);
const removed = ref(false);

/**
 * Форма наполняется ОДИН раз на адрес — как только ленд может на него ответить.
 *
 * Следить за содержимым заметки нельзя: собственное автосохранение вернётся
 * сюда новым снимком и затрёт набранное после него. По той же причине правки
 * соседней вкладки в открытую форму не подхватываются — они лежат в ленде и
 * прочитаются при следующем открытии.
 *
 * Экран переживает смену адреса без перемонтирования (у соседних заметок один
 * маршрут), поэтому состояние, привязанное к адресу, сбрасывается здесь — иначе
 * «Заметка удалена» осталась бы висеть над следующей открытой заметкой.
 */
watch([() => id, note, ready], () => {
  // Пусто до гидрации — это «ещё не знаем», а не «заметки нет».
  if (filled.value === id || (note.value === undefined && !ready.value)) return;
  const source = base.value;
  title.value = source.title;
  body.value = source.body;
  tags.value = source.tags;
  filled.value = id;
  removed.value = false;
  confirming.value = false;
}, { immediate: true });

const dailyLabel = computed(() => {
  const at = base.value.daily;
  return at === undefined ? '' : dayTitle(at);
});

const mentions = computed(() => mentionsOf(base.value, list.value));

/** Теги остальных заметок — материал для подсказки в поле тегов. */
const knownTags = computed(() => countTags(list.value.filter(item => item.id !== id)));

function draftOf(current: Note): Note {
  return { ...current, title: title.value.trim(), body: body.value, tags: [...tags.value] };
}

/**
 * Отложенная запись несёт СВОЙ снимок аргументом, а не читает форму в момент
 * срабатывания. Экран переживает переход к соседней заметке без
 * перемонтирования, и запись, читающая «текущее», дописала бы правку одной
 * заметки в другую.
 */
const store = debounce((next: Note) => {
  actions.save(next);
}, 600, { maxWait: 2500 });

watch([title, body, tags], () => {
  const current = base.value;
  const next = draftOf(current);
  // Наполнение формы со стороны выглядит как правка. Без сравнения `updatedAt`
  // рос бы от одного лишь чтения, список пересортировался бы после каждого
  // захода, а по свободному адресу заводилась бы пустая заметка.
  if (sameContent(current, next)) return;
  store(next);
});

// Смена адреса и уход с экрана — не повод ждать ещё 600 мс с правкой в руках.
watch(() => id, () => {
  store.flush();
  // Соседняя заметка открывается С НАЧАЛА. Список слева прокручивается сам, а
  // страницей прокручен ТЕКСТ, и без сброса следующая заметка открывалась бы на
  // той высоте, до которой дочитали предыдущую.
  window.scrollTo({ top: 0 });
});

onBeforeUnmount(() => {
  store.flush();
});

/** Записать заметку целиком прямо сейчас, вместе с отложенной правкой. */
function commit(patch: Partial<Note>): Note {
  // Отложенная запись отменяется, а не сбрасывается: её содержимое уезжает
  // вместе с изменением, одной транзакцией.
  store.cancel();
  return actions.save({ ...draftOf(base.value), ...patch });
}

function togglePin(): void {
  commit({ pinned: !base.value.pinned });
}

function toggleArchive(): void {
  const was = base.value.archived;
  const moved = commit({ archived: !was });
  toast.show({
    title: moved.archived ? 'Убрано в архив' : 'Возвращено из архива',
    description: noteLabel(moved),
    action: { label: 'Отменить', altText: 'Вернуть заметку туда, где она была', onAction: () => {
      actions.archive(moved, was);
    } },
  });
}

function duplicate(): void {
  store.flush();
  const copy = actions.duplicate(draftOf(base.value));
  toast.show({ title: 'Копия создана', description: noteLabel(copy) });
}

async function copyMarkdown(): Promise<void> {
  const ok = await copyText(noteToMarkdown(draftOf(base.value)));
  toast.show(ok
    ? { title: 'Скопировано', description: 'Заметка ушла в буфер обмена как markdown.' }
    : { title: 'Буфер обмена недоступен', description: 'Браузер не дал доступа.', tone: 'danger' });
}

function remove(): void {
  // Сначала снять отложенную запись: `parts` заводит документ первой записью, и
  // сохранение, доехавшее после удаления, воскресило бы заметку.
  store.cancel();
  const snapshot = draftOf(base.value);
  actions.remove(id);
  confirming.value = false;
  removed.value = true;
  toast.show({
    title: 'Заметка удалена',
    description: noteLabel(snapshot),
    action: { label: 'Отменить', altText: 'Восстановить удалённую заметку', onAction: () => {
      actions.restore(snapshot);
      removed.value = false;
    } },
  });
}

const toolbarActions = computed<ToolbarAction[]>(() => [
  {
    id: 'pin',
    title: base.value.pinned ? 'Открепить' : 'Закрепить',
    icon: Bookmark,
    active: base.value.pinned,
    onSelect: togglePin,
  },
  {
    id: 'archive',
    title: base.value.archived ? 'Из архива' : 'В архив',
    icon: Inbox,
    active: base.value.archived,
    onSelect: toggleArchive,
  },
]);

const menuActions = computed<MenuAction[]>(() => [
  { id: 'duplicate', title: 'Дублировать', icon: Plus, onSelect: duplicate },
  {
    id: 'copy',
    title: 'Скопировать markdown',
    icon: BookOpen,
    onSelect: () => {
      void copyMarkdown();
    },
  },
  {
    id: 'remove',
    title: 'Удалить',
    icon: X,
    danger: true,
    disabled: note.value === undefined,
    onSelect: () => {
      confirming.value = true;
    },
  },
]);

/** Куда можно сослаться: у заметки должен быть заголовок, и это не она сама. */
const linkTargets = computed(() => list.value.filter(item =>
  item.id !== id && !item.archived && item.title !== ''));
</script>

<template>
  <Page v-if="removed" width="list">
    <EmptyState
      title="Заметка удалена"
      description="Отменить удаление можно из сообщения внизу экрана, пока оно висит."
    >
      <template #action>
        <LinkButton size="md" tone="ghost" :to="{ name: 'notes:list' }">К списку</LinkButton>
      </template>
    </EmptyState>
  </Page>

  <Page v-else-if="!ready && note === undefined" width="list">
    <div class="flex justify-center py-16">
      <Spinner class="size-6 text-text-faint" />
    </div>
  </Page>

  <!--
    Мера `list`, а не `reading`: рама делит её между текстом и рельсом связей, и
    на текст остаётся ровно та ширина, ради которой мера и заведена. `reading`
    здесь отдала бы связям половину меры чтения.
  -->
  <Page v-else width="list">
    <template #aside>
      <MentionsPanel :notes="mentions" />
    </template>

    <div class="flex items-center gap-2">
      <!-- «Назад» — только на узком экране: на широком список никуда не
           девался, он слева, и кнопка вела бы туда, где и так стоишь. -->
      <LinkButton class="lg:hidden" tone="ghost" :to="{ name: 'notes:list' }">
        <ChevronLeft class="size-4" />
        Заметки
      </LinkButton>
      <Toolbar class="ml-auto" label="Действия над заметкой" :actions="toolbarActions" />
      <Menu :items="menuActions" label="Ещё действия над заметкой" />
    </div>

    <article class="mt-6 min-w-0">
      <!-- Шапка заметки: заголовок, выходные данные, теги — и линия,
           отделяющая их от текста. Дальше начинается сам текст, и всё
           управляющее до него уже закончилось. -->
      <header class="flex flex-col gap-3 border-b border-line pb-5">
        <Badge v-if="dailyLabel !== ''" tone="accent" class="self-start">
          {{ `Заметка дня · ${dailyLabel}` }}
        </Badge>

        <!-- Своё поле, а не `TextField`: заголовок — это типографика экрана,
             и рамка с подписью над ней превратила бы его в строку формы. -->
        <!-- Поле, а не строка ввода: заголовок набран широким дисплейным
             гротеском, и `input` длинную фразу не переносит, а прокручивает —
             конец названия просто уезжает за край колонки. `field-sizing-content`
             растит поле по тексту, `rows="1"` держит начальную высоту в строку. -->
        <textarea
          v-model="title"
          name="title"
          rows="1"
          aria-label="Заголовок заметки"
          placeholder="Без названия"
          class="text-display field-sizing-content w-full resize-none overflow-hidden bg-transparent
                 text-3xl leading-[1.15] font-medium wrap-break-word text-text caret-accent
                 outline-none placeholder:text-text-faint sm:text-4xl"
          @keydown.enter.prevent
        />

        <NoteMeta :note="base" :body="body" />
        <TagsField v-model="tags" :known="knownTags" />
      </header>

      <!--
        Редактор — на одну заметку (`:key="id"`): соседняя заметка получает
        свежий документ и свою историю отмены. Мера строки ограничена самим
        редактором (68ch): длина строки нужна ГЛАЗУ, а не месту.
      -->
      <NoteEditor
        :key="id"
        v-model="body"
        :notes="linkTargets"
        class="pt-6"
      />
    </article>
  </Page>

  <ConfirmDialog
    v-model:open="confirming"
    :title="`Удалить «${noteLabel(base)}»?`"
    description="Восстановить её будет нечем: истории версий нет. Если нужно просто убрать с глаз — есть архив."
    confirm-label="Удалить"
    @confirm="remove()"
  />
</template>
