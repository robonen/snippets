<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import { debounce } from '@robonen/stdlib';
import { useClipboard } from '@robonen/vue';
import { ChevronLeft, FileDown, Trash2 } from 'lucide-vue-next';
import { downloadText, useToday } from '@brain/module-kit';
import { Card, ConfirmDialog, EmptyState, Menu, Page, Spinner, TagsField, useToast } from '@brain/ui';
import type { MenuAction } from '@brain/ui';
import { useActions, useProjects } from '../../db/composables';
import { UNTITLED, knownMembers, sameProject, stackCounts } from '../../entities/project';
import type { Project } from '../../entities/project';
import { projectToMarkdown } from '../../lib/markdown';
import LinkButton from '../LinkButton.vue';
import JournalCard from './JournalCard.vue';
import LinksCard from './LinksCard.vue';
import PaymentsCard from './PaymentsCard.vue';
import PeriodField from './PeriodField.vue';
import ProjectAside from './ProjectAside.vue';
import StatusPanel from './StatusPanel.vue';
import TeamCard from './TeamCard.vue';

/**
 * Экран проекта: название, статус с пояснением, период, суть, стек, команда,
 * оплаты, ссылки, журнал.
 *
 * Кнопки «Сохранить» нет: запись в ленд локальная и настоящая, откатывать
 * нечего. Правки собираются в СНИМОК и уезжают с задержкой; дочерние карточки
 * не пишут в ленд сами — они отдают новый снимок наверх, и одно место решает,
 * когда и что записать. Так удаление оплаты и правка стоимости в одну секунду
 * не обгоняют друг друга.
 *
 * Порядок карточек — порядок вопросов о проекте: что с ним (статус), когда
 * (период), что это, чем делали, с кем, за сколько, где лежит, что решали.
 */
const { id } = defineProps<{ id: string }>();

const { list, ready } = useProjects();
const actions = useActions();
const toast = useToast();
const today = useToday();
const { copy: writeClipboard, isSupported: clipboardReady } = useClipboard();

const stored = computed(() => list.value.find(item => item.id === id));

/** Снимок, который правит форма. Неизменяемый: каждая правка — новый объект. */
const draft = shallowRef<Project | undefined>();
/** Адрес, форму которого уже наполнили. */
const filled = shallowRef<string | null>(null);
const removed = shallowRef(false);
const confirming = shallowRef(false);

/**
 * Форма наполняется ОДИН раз на адрес — как только ленд может на него
 * ответить. Следить за снимком из ленда нельзя: собственное автосохранение
 * вернулось бы сюда и затёрло набранное после него.
 */
watch([() => id, stored, ready], () => {
  if (filled.value === id) return;
  if (stored.value === undefined) {
    // Пусто до гидрации — это «ещё не знаем», а не «проекта нет».
    if (!ready.value) return;
    draft.value = undefined;
    filled.value = id;
    return;
  }
  draft.value = stored.value;
  filled.value = id;
  removed.value = false;
  confirming.value = false;
}, { immediate: true });

const missing = computed(() => ready.value && stored.value === undefined && !removed.value);

/** Материал для подсказок — из остальных проектов. */
const others = computed(() => list.value.filter(item => item.id !== id));
/** Технологии остальных проектов, самые частые первыми, — подсказки под полем стека. */
const knownStack = computed(() => stackCounts(others.value).map(item => item.name));
const knownPeople = computed(() => knownMembers(others.value));

/**
 * Отложенная запись несёт СВОЙ снимок аргументом: экран переживает переход к
 * соседнему проекту без перемонтирования, и запись, читающая «текущее»,
 * дописала бы правку одного проекта в другой.
 */
const store = debounce((next: Project) => {
  actions.save(next);
}, 600, { maxWait: 2500 });

watch(draft, (next) => {
  const current = stored.value;
  if (next === undefined || current === undefined) return;
  // Наполнение формы выглядит как правка; без сравнения `updatedAt` рос бы от
  // одного лишь открытия, и список пересортировывался бы после каждого захода.
  if (sameProject(current, next)) return;
  store({ ...next, updatedAt: Date.now() });
});

watch(() => id, () => {
  store.flush();
  window.scrollTo({ top: 0 });
});

onBeforeUnmount(() => {
  store.flush();
});

function update(next: Project): void {
  draft.value = next;
}

function patch(part: Partial<Project>): void {
  if (draft.value !== undefined) draft.value = { ...draft.value, ...part };
}

const title = computed({
  get: () => draft.value?.title ?? '',
  set: next => patch({ title: next }),
});

const summary = computed({
  get: () => draft.value?.summary ?? '',
  set: next => patch({ summary: next }),
});

const stack = computed({
  get: () => draft.value?.stack ?? [],
  set: next => patch({ stack: next }),
});

function download(): void {
  if (draft.value === undefined) return;
  store.flush();
  const name = (draft.value.title.trim() || 'project').replaceAll(/[\\/:*?"<>|]+/gu, '-');
  downloadText(`${name}.md`, `${projectToMarkdown(draft.value)}\n`, 'text/markdown;charset=utf-8');
}

/** Отказ буфера показывается словами: молчаливый пункт меню неотличим от сработавшего. */
function copyMarkdown(): void {
  if (draft.value === undefined) return;
  if (!clipboardReady.value) {
    denyCopy();
    return;
  }
  void writeClipboard(projectToMarkdown(draft.value)).then(
    () => toast.show({ title: 'Скопировано', description: 'Проект ушёл в буфер обмена как markdown.' }),
    denyCopy,
  );
}

function denyCopy(): void {
  toast.show({ title: 'Буфер обмена недоступен', description: 'Браузер не дал доступа — скачайте файл.', tone: 'danger' });
}

function remove(): void {
  const snapshot = draft.value;
  if (snapshot === undefined) return;
  // Сначала снять отложенную запись: `parts` заводит документ первой записью, и
  // сохранение, доехавшее после удаления, воскресило бы проект.
  store.cancel();
  actions.remove(id);
  confirming.value = false;
  removed.value = true;
  toast.show({
    title: 'Проект удалён',
    description: snapshot.title || UNTITLED,
    action: {
      label: 'Отменить',
      altText: 'Восстановить удалённый проект',
      onAction: () => {
        actions.save(snapshot);
        removed.value = false;
      },
    },
  });
}

const menu = computed<MenuAction[]>(() => [
  { id: 'download', title: 'Скачать markdown', icon: FileDown, onSelect: download },
  { id: 'copy', title: 'Скопировать markdown', onSelect: copyMarkdown },
  { id: 'remove', title: 'Удалить проект', icon: Trash2, danger: true, onSelect: () => { confirming.value = true; } },
]);
</script>

<template>
  <Page v-if="removed" width="list">
    <EmptyState
      title="Проект удалён"
      description="Отменить удаление можно из сообщения внизу экрана, пока оно висит."
    >
      <template #action>
        <LinkButton size="md" tone="ghost" :to="{ name: 'projects:list' }">К списку</LinkButton>
      </template>
    </EmptyState>
  </Page>

  <Page v-else-if="missing" width="list">
    <EmptyState
      title="Такого проекта нет"
      description="Возможно, он удалён на другом устройстве или ссылка устарела."
    >
      <template #action>
        <LinkButton size="md" tone="ghost" :to="{ name: 'projects:list' }">К проектам</LinkButton>
      </template>
    </EmptyState>
  </Page>

  <Page v-else-if="draft === undefined" width="list">
    <div class="flex justify-center py-16">
      <Spinner class="size-6 text-text-faint" />
    </div>
  </Page>

  <Page v-else width="list">
    <template #aside>
      <ProjectAside :project="draft" :today="today" />
    </template>

    <div class="flex items-center gap-2">
      <LinkButton tone="ghost" :to="{ name: 'projects:list' }">
        <ChevronLeft class="size-4" />
        Проекты
      </LinkButton>
      <Menu class="ml-auto" :items="menu" label="Действия над проектом" />
    </div>

    <article class="mt-6 flex min-w-0 flex-col gap-5">
      <header class="flex flex-col gap-4">
        <!-- Поле, а не строка ввода: заголовок набран дисплейным гротеском, и
             `input` длинную фразу не переносит, а прокручивает. -->
        <textarea
          v-model="title"
          name="title"
          rows="1"
          aria-label="Название проекта"
          :placeholder="UNTITLED"
          class="text-display field-sizing-content w-full resize-none overflow-hidden bg-transparent
                 text-3xl leading-[1.15] font-medium wrap-break-word text-text caret-accent
                 outline-none placeholder:text-text-faint sm:text-4xl"
          @keydown.enter.prevent
        />

        <StatusPanel :project="draft" :today="today" @update="update" />
      </header>

      <Card title="Период">
        <PeriodField :project="draft" :today="today" @update="update" />
      </Card>

      <Card title="Что это?">
        <textarea
          v-model="summary"
          rows="2"
          aria-label="Что это за проект"
          placeholder="Суть в пару абзацев: что делали, для кого и зачем."
          class="field-sizing-content min-h-16 w-full resize-none bg-transparent text-sm leading-relaxed text-text
                 outline-none placeholder:text-text-faint"
        />
      </Card>

      <Card title="Стек">
        <TagsField
          v-model="stack"
          label="Технологии"
          placeholder="Nuxt, Laravel, Docker…"
          :suggestions="knownStack"
          hint="Enter или запятая добавляют технологию; подсказки — из других проектов."
        />
      </Card>

      <TeamCard :members="draft.members" :known="knownPeople" @update="patch({ members: $event })" />

      <PaymentsCard :project="draft" :today="today" @update="update" />

      <LinksCard :links="draft.links" @update="patch({ links: $event })" />

      <JournalCard :journal="draft.journal" :today="today" @update="patch({ journal: $event })" />
    </article>
  </Page>

  <ConfirmDialog
    v-model:open="confirming"
    :title="`Удалить «${draft?.title || UNTITLED}»?`"
    description="Исчезнут оплаты, команда и журнал. Сразу после удаления проект можно вернуть кнопкой «Отменить»."
    confirm-label="Удалить"
    @confirm="remove()"
  />
</template>
