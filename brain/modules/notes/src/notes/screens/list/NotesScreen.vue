<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowDown,
  ArrowDownAZ,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Clock,
  Plus,
  Search,
} from 'lucide-vue-next';
import type { Component } from 'vue';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Menu,
  SegmentedControl,
  Spinner,
  Toolbar,
  useToast,
} from '@brain/ui';
import type { MenuAction, Segment, ToolbarAction } from '@brain/ui';
import { useActions, useNotes } from '../../db/composables';
import { dailyId } from '../../db/actions';
import { exportName, notesToMarkdown } from '../../entities/export';
import { inScope, noteLabel, selectNotes } from '../../entities/note';
import type { Note, NoteScope, NoteSort } from '../../entities/note';
import { countTags } from '../../entities/tags';
import { fmtNotes } from '../../lib/format';
import { toggleTag } from '../../lib/tags';
import LinkButton from '../LinkButton.vue';
import TagChip from '../TagChip.vue';
import NewNoteSheet from './NewNoteSheet.vue';
import NoteRow from './NoteRow.vue';
import NotesSummary from './NotesSummary.vue';
import TagFilter from './TagFilter.vue';
import { downloadText, useToday } from '@brain/module-kit';
import { useClipboard } from '@robonen/vue';

/**
 * Список заметок: срез, порядок, фильтр по тегам, поиск и действия над строкой.
 *
 * Живёт В РЕЛЬСЕ мастер-детали (`NotesLayout`) и потому собран как колонка, а не
 * как страница: шапка с поиском липнет к её верху, содержимое плотное, а
 * ширина — 21 rem. Ниже `lg` та же колонка занимает экран целиком, и всё, что
 * не помещалось в рельс, возвращается по `@container` — по ширине САМОЙ
 * колонки, а не окна: рельс шире окна не станет никогда.
 *
 * Закреплённые стоят своей группой — «что я отложил» отвечается заголовком
 * секции, а не поиском глазами по списку.
 *
 * Всё, кроме гидрации, считается НА МЕСТЕ, из уже прочитанного снимка: сотни
 * заметок фильтруются за доли миллисекунды, а запрос в ленд был бы вторым
 * источником правды о том, что показано на экране.
 *
 * Разрушающие действия идут парой «подтверждение → сообщение с „Отменить“».
 * Диалог защищает от промаха, тост — от передумал: восстановление возвращает
 * снимок, который экран держал в руке, поэтому отменять есть что и после того,
 * как строка исчезла.
 */
const { list, ready } = useNotes();
const actions = useActions();
const route = useRoute();
const router = useRouter();
const { copy: writeClipboard, isSupported: clipboardReady } = useClipboard();
const toast = useToast();

/** Какая заметка открыта справа: строка списка обязана это показывать. */
const openId = computed(() => route.params['id']);

const query = ref('');
const scope = ref<NoteScope>('active');
const sort = ref<NoteSort>('updated');
const tags = ref<readonly string[]>([]);
const creating = ref(false);
const removing = ref<Note | null>(null);

/** Что вообще лежит в текущем срезе — до поиска и до фильтра по тегам. */
const scoped = computed(() => list.value.filter(note => inScope(note, scope.value)));

// Счётчики тегов считаются по срезу, а не по всей коллекции: на вкладке архива
// «12 заметок» у тега значило бы 12 где-то в другом месте.
const counts = computed(() => countTags(scoped.value));

const rows = computed(() => selectNotes(list.value, {
  query: query.value,
  tags: tags.value,
  scope: scope.value,
  sort: sort.value,
}));

/**
 * Полка группами. Закреплённые отделяются только там, где рядом есть
 * незакреплённые: на вкладке «Закреплённые» такой заголовок повторял бы её
 * название, а над однородным списком — обещал бы продолжение, которого нет.
 */
const groups = computed(() => {
  const pinned = rows.value.filter(note => note.pinned);
  if (scope.value !== 'active' || pinned.length === 0 || pinned.length === rows.value.length) {
    return [{ id: 'all', title: '', items: rows.value }];
  }
  return [
    { id: 'pinned', title: 'Закреплённые', items: pinned },
    { id: 'rest', title: 'Остальные', items: rows.value.filter(note => !note.pinned) },
  ];
});

/** До скольких строк лесенка появления читается как изящество, а не как тормоз. */
const STAGGER_LIMIT = 12;

const animate = computed(() => rows.value.length <= STAGGER_LIMIT);

const filtering = computed(() => query.value.trim() !== '' || tags.value.length > 0);

/**
 * Пустое состояние объясняет ПРИЧИНУ пустоты и даёт выход из неё.
 *
 * Причин четыре, и действия у них разные: под фильтр ничего не попало, архив
 * пуст, закреплённого нет, всё уехало в архив. Общий текст «ничего нет» не
 * помог бы ни в одном из случаев — а кнопка, возвращающая туда, где заметки
 * есть, снимает ровно тот тупик, в который человек и пришёл.
 */
const emptyCopy = computed(() => {
  if (filtering.value) {
    return {
      title: 'Ничего не нашлось',
      description: 'Поиск идёт по заголовку и тегам, а выбранные теги сужают выдачу — вместе они могли не оставить ничего. Архив живёт на своей вкладке.',
      label: 'Сбросить поиск и теги',
      run: resetFilters,
    };
  }
  if (scope.value === 'archived') {
    return {
      title: 'Архив пуст',
      description: 'Сюда попадает то, что убрано с глаз: архивная заметка не приходит ни в список, ни в поиск, но лежит целой и возвращается одним действием.',
      label: 'Ко всем заметкам',
      run: showActive,
    };
  }
  if (scope.value === 'pinned') {
    return {
      title: 'Пока ничего не закреплено',
      description: 'Закрепление поднимает заметку в начало списка и собирает такие же рядом — это полка «вернуться сегодня». Закрепить можно из меню строки.',
      label: 'Ко всем заметкам',
      run: showActive,
    };
  }
  return {
    title: 'Все заметки в архиве',
    description: 'Активных не осталось: всё убрано с глаз. Архивные лежат целыми — верните нужную из архива или заведите новую.',
    label: 'Открыть архив',
    run: showArchived,
  };
});

const segments: ReadonlyArray<Segment<NoteScope>> = [
  { value: 'active', label: 'Все' },
  { value: 'pinned', label: 'Закреплённые' },
  { value: 'archived', label: 'Архив' },
];

const SORTS: ReadonlyArray<{ id: NoteSort; title: string; icon: Component }> = [
  { id: 'updated', title: 'По изменению', icon: Clock },
  { id: 'title', title: 'По названию', icon: ArrowDownAZ },
  { id: 'created', title: 'По созданию', icon: CalendarPlus },
];

/**
 * Порядок — только значками: три подписи занимают всю ширину рельса, а рядом
 * ещё срез и теги. Подпись при этом не исчезает, а уходит в `title` и
 * `aria-label`, поэтому и подсказка, и скринридер по-прежнему её называют.
 */
const sortActions = computed<ToolbarAction[]>(() => SORTS.map(item => ({
  id: item.id,
  title: item.title,
  icon: item.icon,
  iconOnly: true,
  active: sort.value === item.id,
  onSelect: () => {
    sort.value = item.id;
  },
})));

/**
 * Выгружается то, что показано, а не вся коллекция.
 *
 * Так одно действие отвечает и на «унеси всё» (фильтров нет — показано всё), и
 * на «унеси найденное». Обратный порядок — всегда всё — заставил бы человека
 * искать нужное уже в выгруженном файле.
 */
const exportItems = computed<MenuAction[]>(() => [
  {
    id: 'copy',
    title: 'Скопировать markdown',
    icon: BookOpen,
    disabled: rows.value.length === 0,
    onSelect: copyShown,
  },
  {
    id: 'file',
    title: 'Сохранить файлом',
    icon: ArrowDown,
    disabled: rows.value.length === 0,
    onSelect: () => {
      downloadText(exportName(new Date()), notesToMarkdown(rows.value), 'text/markdown;charset=utf-8');
      toast.show({ title: 'Файл сохранён', description: fmtNotes(rows.value.length) });
    },
  },
]);

/**
 * Буфер обмена доступен не всегда — только в защищённом контексте и по жесту.
 * Отказа два: самого API может не быть (`isSupported`), и жест может не
 * признать браузер (отказ промиса); оба показываются словами.
 */
function copyShown(): void {
  if (!clipboardReady.value) {
    denyCopy();
    return;
  }
  void writeClipboard(notesToMarkdown(rows.value)).then(
    () => toast.show({ title: 'Скопировано', description: fmtNotes(rows.value.length) }),
    denyCopy,
  );
}

function denyCopy(): void {
  toast.show({ title: 'Буфер обмена недоступен', description: 'Браузер не дал доступа — попробуйте «Сохранить файлом».', tone: 'danger' });
}

function resetFilters(): void {
  query.value = '';
  tags.value = [];
}

function showActive(): void {
  scope.value = 'active';
}

function showArchived(): void {
  scope.value = 'archived';
}

function open(note: Note): void {
  void router.push({ name: 'notes:note', params: { id: note.id } });
}

function pin(note: Note): void {
  actions.save({ ...note, pinned: !note.pinned });
}

function duplicate(note: Note): void {
  const copy = actions.duplicate(note);
  toast.show({
    title: 'Копия создана',
    description: noteLabel(copy),
    action: { label: 'Открыть', altText: 'Открыть копию заметки', onAction: () => {
      open(copy);
    } },
  });
}

function archive(note: Note): void {
  const moved = actions.archive(note, !note.archived);
  toast.show({
    title: moved.archived ? 'Убрано в архив' : 'Возвращено из архива',
    description: noteLabel(moved),
    action: { label: 'Отменить', altText: 'Вернуть заметку туда, где она была', onAction: () => {
      actions.archive(moved, note.archived);
    } },
  });
}

const confirming = computed({
  get: () => removing.value !== null,
  set: (value) => {
    if (!value) removing.value = null;
  },
});

const removingLabel = computed(() => (removing.value === null ? '' : noteLabel(removing.value)));

function confirmRemove(): void {
  const note = removing.value;
  if (note === null) return;
  removing.value = null;
  actions.remove(note.id);
  toast.show({
    title: 'Заметка удалена',
    description: noteLabel(note),
    // Снимок удалённой заметки остался у обработчика, поэтому «Отменить» —
    // настоящее восстановление, а не заведение похожей заметки заново.
    action: { label: 'Отменить', altText: 'Восстановить удалённую заметку', onAction: () => {
      actions.restore(note);
    } },
  });
}

/**
 * Дата — реактивная: список заметок держат открытым сутками, и ссылка «заметка
 * дня», посчитанная один раз при монтировании, после полуночи вела бы во вчера.
 */
const today = useToday();
const dailyNoteId = computed(() => dailyId(today.value));
</script>

<template>
  <div class="@container flex flex-col">
    <!-- Шапка липнет к верху КОЛОНКИ, а не уезжает вместе со списком: рельс
         прокручивается сам, и до поиска из середины сотни строк иначе пришлось
         бы возвращаться прокруткой вверх. -->
    <div class="glass sticky top-0 z-20 flex flex-col gap-2 border-b px-3 py-3">
      <div class="flex items-center gap-1.5">
        <h1 class="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight text-text">
          Заметки
        </h1>

        <LinkButton
          size="icon"
          tone="ghost"
          title="Заметка дня"
          aria-label="Заметка дня"
          :to="{ name: 'notes:note', params: { id: dailyNoteId } }"
        >
          <CalendarDays class="size-4" />
        </LinkButton>

        <Button tone="primary" size="sm" @click="creating = true">
          <Plus class="size-4" />
          Новая
        </Button>

        <Menu :items="exportItems" label="Выгрузка заметок" />
      </div>

      <template v-if="ready && list.length > 0">
        <!-- Своё поле, а не `TextField`: поиск — управление списком, а не ввод
             значения формы, и подпись с подсказкой над ним раздували бы шапку
             ради строки, смысл которой виден по значку и подсказке в поле. -->
        <div class="relative">
          <Search
            aria-hidden="true"
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-faint"
          />
          <input
            v-model="query"
            type="search"
            aria-label="Поиск по заголовкам и тегам"
            placeholder="Заголовок или #тег"
            class="h-10 w-full rounded-control border border-line bg-surface pr-3 pl-9 text-sm text-text
                   transition-colors placeholder:text-text-faint hover:border-line-strong"
          >
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <SegmentedControl v-model="scope" label="Что показывать" :segments="segments" />
          <Toolbar label="Порядок списка" :actions="sortActions" />
          <TagFilter v-model="tags" :counts="counts" />
        </div>

        <div v-if="tags.length > 0" class="flex flex-wrap items-center gap-1.5">
          <TagChip
            v-for="tag in tags"
            :key="tag"
            :tag="tag"
            tone="accent"
            @remove="tags = toggleTag(tags, tag)"
          />
        </div>
      </template>
    </div>

    <div class="flex flex-col gap-3 px-3 py-3">
      <div v-if="!ready" class="flex justify-center py-16">
        <Spinner class="size-6 text-text-faint" />
      </div>

      <EmptyState
        v-else-if="list.length === 0"
        title="Здесь будут заметки"
        description="Заготовки на выбор: пустая, заметка дня, встреча, идея. Ссылка на другую заметку пишется прямо в тексте — [[её заголовок]], — и обратная связь появится сама."
      >
        <template #action>
          <Button tone="primary" @click="creating = true">
            <Plus class="size-4" />
            Новая заметка
          </Button>
        </template>
      </EmptyState>

      <template v-else>
        <!-- Сводка — только там, где колонка шире рельса: на узком экране список
             и есть весь экран, и опора ему нужна. В рельсе 21 rem три крупных
             числа отобрали бы у списка первый экран, поэтому опора десктопа
             стоит справа — на экране «выберите заметку». -->
        <NotesSummary :notes="list" class="hidden @min-[22rem]:grid" />

        <EmptyState
          v-if="rows.length === 0"
          :title="emptyCopy.title"
          :description="emptyCopy.description"
        >
          <template #action>
            <Button @click="emptyCopy.run()">{{ emptyCopy.label }}</Button>
          </template>
        </EmptyState>

        <template v-else>
          <section v-for="group in groups" :key="group.id" class="flex flex-col gap-1.5">
            <h2
              v-if="group.title !== ''"
              class="px-1 text-xs font-medium tracking-wide text-text-faint uppercase"
            >
              {{ group.title }}
            </h2>

            <ul class="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              <NoteRow
                v-for="(note, index) in group.items"
                :key="note.id"
                :note="note"
                :active="note.id === openId"
                :class="animate && 'stagger'"
                :style="{ '--stagger-index': index }"
                @pin="pin(note)"
                @archive="archive(note)"
                @duplicate="duplicate(note)"
                @remove="removing = note"
              />
            </ul>
          </section>
        </template>
      </template>
    </div>

    <NewNoteSheet v-model:open="creating" />

    <ConfirmDialog
      v-model:open="confirming"
      :title="`Удалить «${removingLabel}»?`"
      description="Восстановить её будет нечем: истории версий нет. Если нужно просто убрать с глаз — есть архив."
      confirm-label="Удалить"
      @confirm="confirmRemove()"
    />
  </div>
</template>
