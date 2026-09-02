<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useClipboard } from '@robonen/vue';
import { Plus } from 'lucide-vue-next';
import { Button, ConfirmDialog, Page, PageHeader, Tabs, TagsField, Toolbar, useToast } from '@brain/ui';
import type { Tab, ToolbarAction } from '@brain/ui';
import {
  LINK_SORTS,
  LINK_STATUSES,
  SORT_LABELS,
  STATUS_LABELS,
  countByStatus,
  hasEveryTag,
  sortLinks,
  tagCounts,
} from '../../entities/link';
import type { Bookmark, LinkSort, LinkStatus } from '../../entities/link';
import { useActions, useLinks } from '../../db/composables';
import { addIntent } from '../../lib/intent';
import LinkList from './LinkList.vue';
import LinkSheet from './LinkSheet.vue';
import ReadingQueue from './ReadingQueue.vue';

/**
 * Список закладок: очередь чтения, вкладки статусов, порядок, фильтр по тегам.
 *
 * Экран начинается с ОПОРЫ — очереди чтения крупными числами, — и только потом
 * идёт плотный список. Ритм «крупное → плотное» читается как композиция; ряд
 * одинаковых блоков читался бы как список настроек.
 *
 * Всё это — состояние САМОГО экрана, а не адрес: набор тегов у каждого свой, и
 * ссылка «мои закладки с тегом vue» никому, кроме автора, не пригодится. Когда
 * понадобится делиться выборкой, она переедет в параметры маршрута.
 *
 * Ширина — `list`: строка ссылки живёт заголовком, доменом и действиями справа,
 * и мере для чтения здесь взяться неоткуда. Освободившееся место забирают отбор
 * и порядок — они встают рядом с очередью, а не отдельной полосой над списком.
 */
type StatusTab = LinkStatus | 'all';

const links = useLinks();
const actions = useActions();
const toast = useToast();
const { copy: writeClipboard, isSupported: clipboardReady } = useClipboard();

const tab = shallowRef<StatusTab>('all');
const sort = shallowRef<LinkSort>('added');
const grouped = shallowRef(false);
/**
 * Выбранные теги фильтра. Их несколько, и они сужают выборку, а не расширяют.
 * Список всегда ЗАМЕНЯЕТСЯ целиком, поэтому реф поверхностный: глубокий завёл бы
 * массив в прокси ради правок, которых здесь не бывает.
 */
const tags = shallowRef<string[]>([]);

const sheet = shallowRef(false);
const editing = shallowRef<Bookmark | undefined>();

const removing = shallowRef<Bookmark | undefined>();
const confirming = shallowRef(false);

addIntent.onRequested(() => {
  editing.value = undefined;
  sheet.value = true;
});

// Счётчики вкладок считаются по ВСЕМУ каталогу, а фильтр по тегам — до
// разбивки по статусам: вкладка «читаю» обязана показывать, сколько ссылок
// найдётся под текущим фильтром, а не сколько их всего.
const filtered = computed(() => links.value.filter(link => hasEveryTag(link, tags.value)));
const sorted = computed(() => sortLinks(filtered.value, sort.value));
const counts = computed(() => countByStatus(filtered.value));

const tabs = computed<Array<Tab<StatusTab>>>(() => [
  { value: 'all', label: 'Все', badge: filtered.value.length },
  ...LINK_STATUSES.map(status => ({
    value: status,
    label: STATUS_LABELS[status],
    badge: counts.value[status],
  })),
]);

const panels = computed<Record<StatusTab, Bookmark[]>>(() => ({
  all: sorted.value,
  unread: sorted.value.filter(link => link.status === 'unread'),
  reading: sorted.value.filter(link => link.status === 'reading'),
  done: sorted.value.filter(link => link.status === 'done'),
}));

const toolbar = computed<ToolbarAction[]>(() => [
  ...LINK_SORTS.map(item => ({
    id: `sort:${item}`,
    title: SORT_LABELS[item],
    active: sort.value === item,
    onSelect: () => { sort.value = item; },
  })),
  {
    id: 'grouped',
    title: 'По сайтам',
    active: grouped.value,
    onSelect: () => { grouped.value = !grouped.value; },
  },
]);

/** Все теги каталога, частые первыми, — подсказки фильтра и формы закладки. */
const knownNames = computed(() => tagCounts(links.value).map(item => item.tag));

/** Сузили ли выдачу: выбранный тег или вкладка статуса. */
function narrowed(value: StatusTab): boolean {
  return tags.value.length > 0 || value !== 'all';
}

/**
 * Пустое состояние объясняет ПРИЧИНУ пустоты: «ничего нет» и «под фильтр
 * ничего не попало» требуют разных действий, и общий текст не помогает ни в
 * одном из случаев. Кнопка снимает ровно тот тупик, о котором говорит текст.
 */
function emptyOf(value: StatusTab): { title: string; description: string } {
  if (narrowed(value)) {
    return {
      title: 'Под фильтр ничего не попало',
      description: 'Ссылки никуда не делись: их прячет выбранный тег или вкладка статуса. Снимите фильтр — и каталог вернётся целиком.',
    };
  }
  return {
    title: 'Здесь будет очередь чтения',
    description: 'Сохраните адрес, чтобы вернуться к нему позже: домен и заголовок подставятся из самой ссылки, без сети. Время чтения прикинется по вашей же заметке «зачем сохранил».',
  };
}

/** Показать каталог целиком — выход из пустого состояния под фильтром. */
function showAll(): void {
  tags.value = [];
  tab.value = 'all';
}

function addTag(tag: string): void {
  if (!tags.value.includes(tag)) tags.value = [...tags.value, tag];
}

function add(): void {
  editing.value = undefined;
  sheet.value = true;
}

function edit(link: Bookmark): void {
  editing.value = link;
  sheet.value = true;
}

function setStatus(link: Bookmark, status: LinkStatus): void {
  actions.setStatus(link, status);
}

/**
 * Копирование адреса. Буфер обмена доступен не всегда — только в защищённом
 * контексте и по жесту, — поэтому отказ показывается словами: молчаливая
 * кнопка неотличима от сработавшей.
 *
 * Отказа два, и они разные. Самого API может не быть вовсе: по http на телефоне
 * `navigator.clipboard` — `undefined`, обращение к нему падало бы исключением
 * ещё до промиса, и до слов об отказе дело не доходило. Это ловит `isSupported`;
 * `copy` в таком контексте молча ничего не делает, и без проверки мы отрапортовали
 * бы об успехе. Второй отказ — жест, которого браузер не признал, — приезжает
 * отказом промиса.
 */
function copy(link: Bookmark): void {
  if (!clipboardReady.value) {
    denyCopy();
    return;
  }
  void writeClipboard(link.url).then(
    () => toast.show({ title: 'Адрес скопирован', description: link.url, tone: 'positive' }),
    denyCopy,
  );
}

function denyCopy(): void {
  toast.show({
    title: 'Не удалось скопировать',
    description: 'Буфер обмена недоступен — адрес можно выделить в форме правки.',
    tone: 'danger',
  });
}

function askRemove(link: Bookmark): void {
  removing.value = link;
  confirming.value = true;
}

// Удаление подтверждается диалогом И остаётся отменяемым: подтверждение ловит
// промах пальцем, «Отменить» — передумавшего. Снимок закладки уже на руках,
// поэтому возврат — это обычная запись под тем же id.
function confirmRemove(): void {
  const link = removing.value;
  if (link === undefined) return;

  actions.removeLink(link.id);
  removing.value = undefined;
  toast.show({
    title: 'Ссылка удалена',
    description: link.title,
    action: {
      label: 'Отменить',
      altText: 'Восстановить удалённую закладку',
      onAction: () => actions.saveLink(link),
    },
  });
}
</script>

<template>
  <Page width="list">
    <div class="flex flex-col gap-4">
      <PageHeader title="Закладки">
        <template #action>
          <Button tone="primary" size="sm" @click="add">
            <Plus class="size-4" />
            Добавить
          </Button>
        </template>
      </PageHeader>

      <!--
        Опора и отбор делят строку с `lg`. Порознь очередь чтения растягивалась
        полосой во всю ширину ради двух чисел, а панель отбора занимала под собой
        отдельный этаж — вместе они читаются как одна шапка: «сколько осталось»
        слева, «что показывать» справа. Пустому каталогу делить нечего.
      -->
      <div
        class="grid gap-4"
        :class="links.length > 0 && 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start'"
      >
        <ReadingQueue v-if="links.length > 0" :links="links" />

        <div class="flex flex-col gap-2">
          <Toolbar label="Порядок и вид списка" :actions="toolbar" class="overflow-x-auto" />

          <!-- Фильтр — тот же список тегов, что и на закладке: набор сужает
               выборку, подсказки — теги каталога, частые первыми. -->
          <TagsField
            v-if="knownNames.length > 0 || tags.length > 0"
            v-model="tags"
            label="Фильтр по тегам"
            placeholder="Тег"
            :suggestions="knownNames"
          />
        </div>
      </div>

      <Tabs v-model="tab" :items="tabs" label="Статус чтения">
        <!-- Панели раздаются динамическими именами слотов: список в них один и
             тот же, и четыре копии его разметки разошлись бы на первой правке. -->
        <template v-for="item in tabs" :key="item.value" #[item.value]>
          <LinkList
            :links="panels[item.value]"
            :grouped="grouped"
            :empty-title="emptyOf(item.value).title"
            :empty-description="emptyOf(item.value).description"
            @status="setStatus"
            @edit="edit"
            @copy="copy"
            @remove="askRemove"
            @tag="addTag"
          >
            <template #empty-action>
              <Button v-if="narrowed(item.value)" @click="showAll()">Показать все ссылки</Button>
              <Button v-else tone="primary" @click="add()">
                <Plus class="size-4" />
                Добавить ссылку
              </Button>
            </template>
          </LinkList>
        </template>
      </Tabs>
    </div>

    <LinkSheet
      v-model:open="sheet"
      :link="editing"
      :known-tags="knownNames"
      @save="actions.saveLink"
    />

    <ConfirmDialog
      v-model:open="confirming"
      :title="`Удалить «${removing?.title ?? ''}»?`"
      description="Ссылка исчезнет из списка. Сразу после удаления её можно вернуть кнопкой «Отменить»."
      @confirm="confirmRemove"
    />
  </Page>
</template>
