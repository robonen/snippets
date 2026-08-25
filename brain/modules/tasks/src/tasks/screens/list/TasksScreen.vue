<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue';
import type { Component } from 'vue';
import { CalendarClock, CircleCheck, Inbox, Moon, Plus, Sun } from 'lucide-vue-next';
import { Badge, Button, ConfirmDialog, Page, PageHeader, SegmentedControl, Tabs, useToast } from '@brain/ui';
import type { Segment, Tab } from '@brain/ui';
import { useToday } from '@brain/module-kit';
import { useActions, useProjects, useTasks } from '../../db/composables';
import { PRIORITY_LABELS } from '../../entities/priority';
import { hasHints, parseQuickTask } from '../../entities/quick';
import { BUCKETS, BUCKET_HINTS, BUCKET_LABELS, bucketOf, draftFor, isDone, sortTasks } from '../../entities/task';
import type { Bucket, Task, TaskDraft } from '../../entities/task';
import { calendarDay, tasksLabel } from '../../lib/format';
import { OVERVIEW, takeView, viewFromSearch, viewRequest } from '../view';
import type { Panel, ViewRequest } from '../view';
import DayHeader from './DayHeader.vue';
import EmptyPanel from './EmptyPanel.vue';
import OverviewPanel from './OverviewPanel.vue';
import TaskRow from './TaskRow.vue';
import TaskSheet from './TaskSheet.vue';

/**
 * Список задач: корзины, быстрый ввод с разбором, фильтр по проекту, обзор и
 * лист правки.
 *
 * Композиция держится на ОПОРЕ: сегодняшний день сверху крупно, вкладки и
 * плотный список под ним. Ряд одинаковых блоков (заголовок, поле, вкладки,
 * список) читался бы как список настроек — экрану нужна точка, с которой
 * начинается взгляд, и день на эту роль подходит лучше любой другой сводки.
 *
 * Сегодняшний день читается ОДИН раз на монтирование и раздаётся вниз пропом.
 * Экран, переживший полночь, покажет вчерашнюю раскладку до следующего открытия —
 * и это честнее, чем строки, которые переезжают из корзины в корзину под руками.
 */
const today = useToday();

/**
 * Значение сегмента «Все» — не пустая строка: `SegmentedControl` пустое значение
 * отбрасывает (повторное нажатие на активный сегмент не должно гасить полоску),
 * и фильтр «Все» стал бы единственным, который нельзя выбрать. Идентификаторы
 * проектов — UUID, столкнуться с этим словом им нечем.
 */
const ALL_PROJECTS = 'all';

/**
 * Пустая корзина объясняет СЕБЯ. «Пусто» пользователь и так видит; вопрос, на
 * который он не знает ответа, — чем эта корзина отличается от соседней и что в
 * неё кладут. Поэтому у каждой свои значок, заголовок и кнопка, а пояснение
 * приходит из домена (`BUCKET_HINTS`) — там же, где живут правила раскладки.
 */
const EMPTY: Record<Bucket, { icon: Component; title: string; action: string }> = {
  inbox: { icon: Inbox, title: 'Инбокс пуст', action: 'Записать дело' },
  today: { icon: Sun, title: 'На сегодня ничего не назначено', action: 'Добавить дело на сегодня' },
  scheduled: { icon: CalendarClock, title: 'Планов на будущее нет', action: 'Запланировать дело' },
  someday: { icon: Moon, title: 'Отложенного нет', action: 'Отложить дело' },
  done: { icon: CircleCheck, title: 'Закрытых дел пока нет', action: 'К сегодняшним делам' },
};

const tasks = useTasks();
const projects = useProjects();
const actions = useActions();
const toast = useToast();

const panel = shallowRef<Panel>('inbox');
const projectFilter = shallowRef<string | null>(null);
const draft = shallowRef('');
const editingId = shallowRef<string | null>(null);
const removingProject = shallowRef(false);

const quick = useTemplateRef<HTMLInputElement>('quick');

const projectNames = computed(() => new Map(projects.value.map(item => [item.id, item.name])));

const visible = computed(() => {
  const filter = projectFilter.value;
  if (filter === null) return tasks.value;
  return tasks.value.filter(task => task.project === filter);
});

const byBucket = computed(() => {
  const map = new Map<Bucket, Task[]>(BUCKETS.map((id): [Bucket, Task[]] => [id, []]));
  for (const task of visible.value) map.get(bucketOf(task, today.value))?.push(task);
  return map;
});

/**
 * Счётчик у вкладки показывает только НЕЗАКРЫТОЕ: «Выполнено: 412» — это не
 * счётчик, а возраст архива, и рядом с «Сегодня: 3» он ни о чём не говорит.
 */
const tabs = computed<Array<Tab<Panel>>>(() => {
  const buckets: Array<Tab<Panel>> = BUCKETS.map((id) => {
    const count = byBucket.value.get(id)?.length ?? 0;
    const tab: Tab<Panel> = { value: id, label: BUCKET_LABELS[id] };
    if (id !== 'done' && count > 0) return { ...tab, badge: count };
    return tab;
  });
  return [...buckets, { value: OVERVIEW, label: 'Обзор' }];
});

const bucket = computed<Bucket>(() => (panel.value === OVERVIEW ? 'inbox' : panel.value));
const composing = computed(() => panel.value !== OVERVIEW && panel.value !== 'done');

/** Есть ли что показывать рядом с опорой дня: ввод, фильтр проектов или оба. */
const controls = computed(() => composing.value || projects.value.length > 0);

const editing = computed(() => tasks.value.find(task => task.id === editingId.value) ?? null);
const openCount = computed(() => tasks.value.filter(task => !isDone(task)).length);

/**
 * Список считается ДЛЯ КОРЗИНЫ, а не для «активной вкладки»: панели вкладок
 * монтируются по одной, но опираться на это значило бы, что порядок строк
 * зависит от того, какая вкладка сейчас открыта.
 */
function listOf(id: Bucket): Task[] {
  return sortTasks(byBucket.value.get(id) ?? [], id);
}

/** Фильтр проектов — сегменты: у него нет панелей, он меняет ЗНАЧЕНИЕ. */
const projectSegments = computed<Array<Segment<string>>>(() => [
  { value: ALL_PROJECTS, label: 'Все' },
  ...projects.value.map(item => ({ value: item.id, label: item.name })),
]);

const projectValue = computed({
  get: () => projectFilter.value ?? ALL_PROJECTS,
  set: (next: string) => {
    projectFilter.value = next === ALL_PROJECTS ? null : next;
  },
});

const filteredProject = computed(() => (
  projectFilter.value === null ? null : projectNames.value.get(projectFilter.value) ?? null
));

/**
 * Что разбор понял в набранной строке — показывается ДО нажатия Enter.
 *
 * Иначе грамматика быстрого ввода остаётся тайным знанием: пользователь узнаёт,
 * что `#дом` стало проектом, только по исчезнувшему из заголовка слову, а что
 * `!ассап` не стало приоритетом — вообще никогда.
 */
const parsed = computed(() => parseQuickTask(draft.value, today.value));

const previewHints = computed(() => {
  const hints: string[] = [];
  if (parsed.value.dueAt !== undefined) hints.push(calendarDay(parsed.value.dueAt));
  if (parsed.value.project !== undefined) hints.push(`#${parsed.value.project}`);
  if (parsed.value.priority !== undefined) hints.push(PRIORITY_LABELS[parsed.value.priority]);
  return hints;
});

// Заявка от команды палитры — и та же дверь для ссылок из глобального поиска
// (`/tasks?task=…`): роутера у модуля нет, разбирать адрес больше некому.
watch(viewRequest, () => {
  apply(takeView());
}, { immediate: true });
apply(viewFromSearch(globalThis.location.search));

function apply(view: ViewRequest | null): void {
  if (view === null) return;
  panel.value = view.panel;
  if (view.task !== undefined) editingId.value = view.task;
  if (view.compose === true) focusQuick();
}

function focusQuick(): void {
  void nextTick(() => {
    quick.value?.focus();
  });
}

/**
 * Проект из строки ввода приезжает НАЗВАНИЕМ: разбор про идентификаторы ленда не
 * знает. Совпадение ищется без учёта регистра — «#Дом» и «#дом» это один проект,
 * и заводить второй ради заглавной буквы было бы ловушкой.
 */
function projectIdFor(name: string): string | undefined {
  const needle = name.trim().toLocaleLowerCase('ru');
  const found = projects.value.find(item => item.name.toLocaleLowerCase('ru') === needle);
  return found?.id ?? actions.addProject(name)?.id;
}

function submit(): void {
  const quickTask = parsed.value;
  if (quickTask.title === '') return;

  // Задача рождается в ОТКРЫТОЙ корзине: набрать дело в «Сегодня» и увидеть,
  // как оно улетело в инбокс, — сломанный ввод, а не строгая модель. Разбор
  // строки сильнее корзины: срок, названный вслух, отменяет умолчание.
  const next: TaskDraft = { ...draftFor(bucket.value, today.value), title: quickTask.title };
  if (quickTask.dueAt !== undefined) next.dueAt = quickTask.dueAt;
  if (quickTask.priority !== undefined) next.priority = quickTask.priority;

  const project = quickTask.project === undefined ? projectFilter.value : projectIdFor(quickTask.project);
  if (project !== null && project !== undefined) next.project = project;

  actions.add(next);
  draft.value = '';
}

function toggle(task: Task): void {
  actions.setDone(task.id, !isDone(task));
}

/**
 * Удаление подтверждать не нужно — нужно уметь его ОТМЕНИТЬ. Диалог на каждое
 * удаление превращается в рефлекс «да», а тост с «Отменить» стоит пяти секунд
 * внимания и возвращает задачу целиком, вместе с подзадачами и ключом.
 */
function remove(task: Task): void {
  if (editingId.value === task.id) editingId.value = null;
  const removed = actions.remove(task.id);
  if (removed === null) return;

  toast.show({
    title: 'Задача удалена',
    description: removed.title,
    action: {
      label: 'Отменить',
      altText: 'Восстановить удалённую задачу',
      onAction: () => {
        actions.restore(removed);
      },
    },
  });
}

function reschedule(task: Task, dueAt: string | null): void {
  actions.save({ ...task, dueAt: dueAt ?? undefined, updatedAt: Date.now() });
}

function dropProject(): void {
  const id = projectFilter.value;
  if (id === null) return;
  projectFilter.value = null;
  removingProject.value = false;
  actions.removeProject(id);
}

/**
 * Из сводки — в дела этого проекта. Вкладка выбирается ПЕРВАЯ НЕПУСТАЯ, а не
 * инбокс: у проекта, который весь состоит из запланированного, инбокс пуст, и
 * переход из строки «7 задач» в пустой экран выглядит как потеря данных.
 */
function pickFromOverview(project: string | undefined): void {
  projectFilter.value = project ?? null;
  panel.value = BUCKETS.find(id => (byBucket.value.get(id)?.length ?? 0) > 0) ?? 'inbox';
}

/**
 * Кнопка пустой корзины. Везде это «завести дело прямо здесь», и только в
 * «Выполнено» — переход: закрытая задача рождается закрытием, а не вводом, и
 * поле ввода в этой корзине не показывается вовсе.
 */
function fill(id: Bucket): void {
  if (id === 'done') {
    panel.value = 'today';
    return;
  }
  focusQuick();
}

function compose(): void {
  panel.value = 'inbox';
  focusQuick();
}
</script>

<template>
  <Page width="list">
    <div class="flex flex-col gap-4">
      <PageHeader title="Задачи" :subtitle="`${tasksLabel(openCount)} в работе`" />

      <!--
        Опора и ввод делят строку с `lg`. Порознь они оставляли под днём широкую
        полосу поля ввода — единственную строку на весь экран; рядом опора
        перестаёт быть лентой во всю ширину, а поле оказывается там, куда и так
        смотрят после числа оставшихся дел.

        Делит строку именно ВВОД: в «Выполнено» и в обзоре его нет, и колонка из
        одного переключателя проектов оставляла бы полэкрана пустоты — там фильтр
        честно встаёт под опорой.
      -->
      <div
        class="grid gap-4"
        :class="composing && 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start'"
      >
        <!-- Опора экрана. Дальше всё плотнее и мельче — этот перепад и есть
             композиция; ряд одинаковых блоков ею не является. -->
        <DayHeader :tasks="tasks" :today="today" @open="panel = 'today'" />

        <div v-if="controls" class="flex flex-col gap-3">
          <form v-if="composing" class="flex flex-col gap-1.5" @submit.prevent="submit">
            <div class="flex items-center gap-2">
              <input
                ref="quick"
                v-model="draft"
                type="text"
                aria-label="Новая задача"
                placeholder="завтра купить молока #дом !высокий"
                class="h-11 min-w-0 flex-1 rounded-control border border-line bg-surface px-3.5 text-sm
                       text-text transition-colors placeholder:text-text-faint hover:border-line-strong
                       focus:border-accent focus:outline-none"
              >
              <Button type="submit" tone="primary" :disabled="parsed.title === ''" aria-label="Добавить задачу">
                <Plus class="size-4" />
              </Button>
            </div>

            <p v-if="hasHints(parsed)" class="flex flex-wrap items-center gap-1.5 text-xs text-text-faint">
              <span>{{ parsed.title === '' ? 'Без названия' : parsed.title }}</span>
              <Badge v-for="hint in previewHints" :key="hint" tone="accent">{{ hint }}</Badge>
            </p>
          </form>

          <div v-if="projects.length > 0" class="flex items-center gap-2 overflow-x-auto">
            <SegmentedControl v-model="projectValue" label="Проект" :segments="projectSegments" />
            <Button
              v-if="filteredProject !== null"
              tone="ghost"
              size="sm"
              class="ml-auto"
              @click="removingProject = true"
            >
              Удалить проект
            </Button>
          </div>
        </div>
      </div>

      <!--
        На широком экране полоска вкладок ПЕРЕНОСИТСЯ, а не прокручивается:
        спрятанная за краем корзина не существует для того, кто про неё не знал, а
        горизонтальная прокрутка мышью — это ещё и лишний жест. На телефоне
        прокрутка остаётся: там перенос съел бы половину экрана.

        `scrollbar-width` гасит полосу прокрутки у самой ленты вкладок. `overflow-x`
        в ките включает вместе с собой и вертикальную прокрутку, а подчёркивание
        активной вкладки выступает на пиксель (`-mb-px`) — этого пикселя хватает,
        чтобы система нарисовала вечную вертикальную полосу поперёк вкладок и
        отъела под неё пятнадцать. Чинить это правильнее в ките; здесь — чтобы
        полоса не резала экран.
      -->
      <Tabs
        v-model="panel"
        :items="tabs"
        label="Корзины задач"
        class="sm:[&>*:first-child]:flex-wrap [&>*:first-child]:[scrollbar-width:none]"
      >
        <template v-for="id in BUCKETS" :key="id" #[id]>
          <!-- Одна поверхность с разделителями, а не карточка на каждую строку:
               сорок карточек с одинаковой рамкой — решётка, в которой нечего
               искать. -->
          <ul
            v-if="listOf(id).length > 0"
            class="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface"
          >
            <TaskRow
              v-for="task in listOf(id)"
              :key="task.id"
              :task="task"
              :today="today"
              :project-name="task.project === undefined ? undefined : projectNames.get(task.project)"
              @toggle="toggle(task)"
              @open="editingId = task.id"
              @remove="remove(task)"
              @schedule="dueAt => reschedule(task, dueAt)"
            />
          </ul>

          <EmptyPanel
            v-else
            :icon="EMPTY[id].icon"
            :title="EMPTY[id].title"
            :description="BUCKET_HINTS[id]"
            :action="EMPTY[id].action"
            @act="fill(id)"
          />
        </template>

        <!-- Обзор смотрит на ВСЕ задачи, а не на отфильтрованные: разбивка по
             проектам под включённым фильтром схлопнулась бы в одну строку —
             то есть ровно в то, что фильтр и так показывает. -->
        <template #[OVERVIEW]>
          <OverviewPanel
            :tasks="tasks"
            :projects="projects"
            :today="today"
            @pick="pickFromOverview"
            @compose="compose"
          />
        </template>
      </Tabs>
    </div>

    <TaskSheet
      v-if="editing !== null"
      :key="editing.id"
      :task="editing"
      :projects="projects"
      @close="editingId = null"
      @remove="remove(editing)"
    />

    <ConfirmDialog
      v-model:open="removingProject"
      :title="`Удалить проект «${filteredProject ?? ''}»?`"
      description="Задачи проекта останутся — они просто перестанут быть его частью."
      confirm-label="Удалить проект"
      @confirm="dropProject"
    />
  </Page>
</template>
