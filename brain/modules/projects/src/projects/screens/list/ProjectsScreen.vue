<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import { useClipboard } from '@robonen/vue';
import { FileDown, FileUp, Plus } from 'lucide-vue-next';
import { downloadText, useToday } from '@brain/module-kit';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Menu,
  Page,
  PageHeader,
  StatTile,
  Tabs,
  TextField,
  Toolbar,
  useToast,
} from '@brain/ui';
import type { MenuAction, Tab, ToolbarAction } from '@brain/ui';
import {
  PROJECT_SORTS,
  PROJECT_STATUSES,
  SORT_LABELS,
  STATUS_LABELS,
  UNTITLED,
  countByStatus,
  groupByYear,
  matchesQuery,
  myTotal,
  receivedIn,
  sortProjects,
  withStatus,
} from '../../entities/project';
import type { Project, ProjectSort, ProjectStatus } from '../../entities/project';
import type { NewProject } from '../../db/actions';
import { useActions, useProjects } from '../../db/composables';
import { fmtMoney, fmtProjects } from '../../lib/format';
import { addIntent } from '../../lib/intent';
import { exportName, projectsToMarkdown } from '../../lib/markdown';
import type { ImportedProject } from '../../lib/markdown';
import ImportSheet from './ImportSheet.vue';
import NewProjectSheet from './NewProjectSheet.vue';
import ProjectRow from './ProjectRow.vue';

/**
 * Список проектов: сводка, поиск, вкладки статусов, порядок.
 *
 * Экран начинается со СВОДКИ — сколько в работе, сколько отложено и сколько
 * принёс год — и только потом идёт плотный список. Порядок «по началу»
 * раскладывает список по годам: так он читается как хроника, ровно как старый
 * файл «Проекты 2023», только без ручной переклейки заголовков.
 *
 * Фильтры — состояние экрана, а не адреса: выборка «на паузе со стеком Nuxt»
 * нужна автору, а не ссылке.
 */
type StatusTab = ProjectStatus | 'all';

const router = useRouter();
const { list, ready } = useProjects();
const actions = useActions();
const toast = useToast();
const today = useToday();
const { copy: writeClipboard, isSupported: clipboardReady } = useClipboard();

const tab = shallowRef<StatusTab>('all');
const sort = shallowRef<ProjectSort>('activity');
const query = ref('');

const sheet = shallowRef(false);
const importing = shallowRef(false);

const removing = shallowRef<Project | undefined>();
const confirming = shallowRef(false);

addIntent.onRequested(() => {
  sheet.value = true;
});

const year = computed(() => Number(today.value.slice(0, 4)));
const month = computed(() => today.value.slice(0, 7));

/** Сводка считается по ВСЕМУ каталогу: поиск сужает список, а не год. */
const overview = computed(() => countByStatus(list.value));
/**
 * Деньги — за этот год, а если в этом году ещё ничего не пришло, то за всё
 * время: «0 ₽ в 2026» в январе — правда, но бесполезная, а «получено всего»
 * хотя бы отвечает, ради чего это всё велось.
 */
const received = computed(() => {
  const thisYear = receivedIn(list.value, year.value);
  if (thisYear > 0) return { value: thisYear, label: `получено в ${year.value}` };
  return { value: list.value.reduce((sum, project) => sum + myTotal(project), 0), label: 'получено всего' };
});

const filtered = computed(() => list.value.filter(project => matchesQuery(project, query.value)));
const sorted = computed(() => sortProjects(filtered.value, sort.value));
const counts = computed(() => countByStatus(filtered.value));

const tabs = computed<Array<Tab<StatusTab>>>(() => [
  { value: 'all', label: 'Все', badge: filtered.value.length },
  ...PROJECT_STATUSES.map(status => ({
    value: status,
    label: STATUS_LABELS[status],
    badge: counts.value[status],
  })),
]);

const panels = computed<Record<StatusTab, Project[]>>(() => ({
  all: sorted.value,
  active: sorted.value.filter(project => project.status === 'active'),
  paused: sorted.value.filter(project => project.status === 'paused'),
  done: sorted.value.filter(project => project.status === 'done'),
  dropped: sorted.value.filter(project => project.status === 'dropped'),
}));

const toolbar = computed<ToolbarAction[]>(() => PROJECT_SORTS.map(item => ({
  id: `sort:${item}`,
  title: SORT_LABELS[item],
  active: sort.value === item,
  onSelect: () => { sort.value = item; },
})));

const headerMenu = computed<MenuAction[]>(() => [
  { id: 'download', title: 'Скачать markdown', icon: FileDown, disabled: list.value.length === 0, onSelect: download },
  { id: 'copy', title: 'Скопировать markdown', disabled: list.value.length === 0, onSelect: copyAll },
  { id: 'import', title: 'Импорт из markdown', icon: FileUp, onSelect: () => { importing.value = true; } },
]);

function narrowed(value: StatusTab): boolean {
  return query.value.trim() !== '' || value !== 'all';
}

/**
 * Пустое состояние объясняет ПРИЧИНУ пустоты: «проектов нет» и «под поиск
 * ничего не попало» требуют разных действий.
 */
function emptyOf(value: StatusTab): { title: string; description: string } {
  if (narrowed(value)) {
    return {
      title: 'Ничего не нашлось',
      description: 'Проекты на месте — их прячет поиск или вкладка статуса. Снимите фильтр, и список вернётся целиком.',
    };
  }
  return {
    title: 'Здесь будет история проектов',
    description: 'Каждый проект — со статусом и его причиной, периодом, стеком, командой и оплатами с остатком. Старый markdown-файл переезжает сюда одной вставкой.',
  };
}

function showAll(): void {
  query.value = '';
  tab.value = 'all';
}

function add(): void {
  sheet.value = true;
}

/** Создать и сразу открыть: заполнять проект удобнее на его странице. */
function create(draft: NewProject): void {
  const project = actions.create(draft);
  void router.push({ name: 'projects:project', params: { id: project.id } });
}

function setStatus(project: Project, status: ProjectStatus): void {
  actions.save(withStatus(project, status, today.value, Date.now()));
}

function download(): void {
  downloadText(exportName(new Date()), projectsToMarkdown(list.value), 'text/markdown;charset=utf-8');
}

/**
 * Буфер обмена доступен не всегда — только в защищённом контексте и по жесту.
 * Отказа два: самого API может не быть (`isSupported`), и жест может не
 * признать браузер (отказ промиса); оба показываются словами, потому что
 * молчаливая кнопка неотличима от сработавшей.
 */
function copyAll(): void {
  if (!clipboardReady.value) {
    denyCopy();
    return;
  }
  void writeClipboard(projectsToMarkdown(list.value)).then(
    () => toast.show({ title: 'Скопировано', description: `${fmtProjects(list.value.length)} ушли в буфер обмена как markdown.` }),
    denyCopy,
  );
}

function denyCopy(): void {
  toast.show({ title: 'Буфер обмена недоступен', description: 'Браузер не дал доступа — скачайте файл.', tone: 'danger' });
}

function importAll(imported: ImportedProject[]): void {
  const added = actions.import(imported);
  toast.show({
    title: `Импортировано: ${fmtProjects(added.length)}`,
    description: added.map(project => project.title).slice(0, 3).join(', ') + (added.length > 3 ? '…' : ''),
    tone: 'positive',
  });
  sort.value = 'start';
}

function askRemove(project: Project): void {
  removing.value = project;
  confirming.value = true;
}

// Удаление подтверждается диалогом И остаётся отменяемым: подтверждение ловит
// промах пальцем, «Отменить» — передумавшего. Снимок уже на руках, поэтому
// возврат — это обычная запись под тем же id.
function confirmRemove(): void {
  const project = removing.value;
  if (project === undefined) return;
  actions.remove(project.id);
  removing.value = undefined;
  toast.show({
    title: 'Проект удалён',
    description: project.title || UNTITLED,
    action: {
      label: 'Отменить',
      altText: 'Восстановить удалённый проект',
      onAction: () => actions.save(project),
    },
  });
}
</script>

<template>
  <Page width="list">
    <div class="flex flex-col gap-4">
      <PageHeader title="Проекты" :subtitle="ready && list.length > 0 ? fmtProjects(list.length) : undefined">
        <template #action>
          <div class="flex items-center gap-1">
            <Button tone="primary" size="sm" @click="add">
              <Plus class="size-4" />
              Новый проект
            </Button>
            <Menu :items="headerMenu" label="Выгрузка и импорт" />
          </div>
        </template>
      </PageHeader>

      <div v-if="list.length > 0" class="grid grid-cols-3 gap-2">
        <StatTile :value="String(overview.active)" label="в работе" />
        <StatTile :value="String(overview.paused)" label="на паузе" />
        <StatTile :value="fmtMoney(received.value)" :label="received.label" />
      </div>

      <div
        v-if="list.length > 0"
        class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      >
        <TextField
          v-model="query"
          label="Поиск"
          type="search"
          inputmode="search"
          placeholder="Название, стек, человек"
        />
        <Toolbar label="Порядок списка" :actions="toolbar" class="overflow-x-auto" />
      </div>

      <Tabs v-if="list.length > 0" v-model="tab" :items="tabs" label="Статус проекта">
        <!-- Панели раздаются динамическими именами слотов: список один и тот
             же, и пять копий его разметки разошлись бы на первой правке. -->
        <template v-for="item in tabs" :key="item.value" #[item.value]>
          <EmptyState
            v-if="panels[item.value].length === 0"
            :title="emptyOf(item.value).title"
            :description="emptyOf(item.value).description"
          >
            <template #action>
              <Button v-if="narrowed(item.value)" @click="showAll()">Показать все проекты</Button>
            </template>
          </EmptyState>

          <!-- «По началу» — хроника по годам, как в старом файле. -->
          <div v-else-if="sort === 'start'" class="flex flex-col gap-4">
            <section v-for="group in groupByYear(panels[item.value])" :key="group.year" class="flex flex-col gap-1.5">
              <h3 class="text-display px-1 text-lg text-text-soft">{{ group.year }}</h3>
              <ul class="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                <ProjectRow
                  v-for="project in group.projects"
                  :key="project.id"
                  :project="project"
                  @status="setStatus(project, $event)"
                  @remove="askRemove(project)"
                />
              </ul>
            </section>
          </div>

          <ul v-else class="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            <ProjectRow
              v-for="project in panels[item.value]"
              :key="project.id"
              :project="project"
              @status="setStatus(project, $event)"
              @remove="askRemove(project)"
            />
          </ul>
        </template>
      </Tabs>

      <EmptyState
        v-else-if="ready"
        :title="emptyOf('all').title"
        :description="emptyOf('all').description"
      >
        <template #action>
          <div class="flex flex-wrap justify-center gap-2">
            <Button tone="primary" @click="add()">
              <Plus class="size-4" />
              Новый проект
            </Button>
            <Button tone="ghost" @click="importing = true">
              <FileUp class="size-4" />
              Импорт из markdown
            </Button>
          </div>
        </template>
      </EmptyState>
    </div>

    <NewProjectSheet v-model:open="sheet" :default-month="month" @create="create" />
    <ImportSheet v-model:open="importing" :year="year" @import="importAll" />

    <ConfirmDialog
      v-model:open="confirming"
      :title="`Удалить «${removing?.title || UNTITLED}»?`"
      description="Исчезнут оплаты, команда и журнал проекта. Сразу после удаления его можно вернуть кнопкой «Отменить»."
      confirm-label="Удалить"
      @confirm="confirmRemove"
    />
  </Page>
</template>
