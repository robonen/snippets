import { defineModule, newId } from '@brain/module-kit';
import { ListTodo } from 'lucide-vue-next';
import { dayTitle, todayISO } from '@brain/std';
import { MODULE_ID, TasksModel, readTask, writeTask } from './db/models';
import { PRIORITY_LABELS, isNotable } from './entities/priority';
import { parseQuickTask } from './entities/quick';
import { progressOf } from './entities/step';
import { BUCKETS, BUCKET_LABELS, bucketOf, createTask, matchesQuery, nextOrder, sortTasks } from './entities/task';
import type { Task } from './entities/task';
import { OVERVIEW, requestView } from './screens/view';
import TasksScreen from './screens/list/TasksScreen.vue';
import TodayTasksWidget from './screens/today/TodayTasksWidget.vue';

/**
 * ЗАДАЧИ — GTD-lite как модуль brain: инбокс, сегодня, запланировано,
 * когда-нибудь, выполнено; проекты как группировка и повторы.
 *
 * Посева нет намеренно: пустой инбокс — правильное первое состояние, а
 * демо-задачи пришлось бы удалять руками, причём на каждом устройстве.
 */

/** Больше выдачи в палитре всё равно не помещается. */
const SEARCH_LIMIT = 8;

export const tasksModule = defineModule({
  id: MODULE_ID,
  title: 'Задачи',
  icon: ListTodo,
  land: { root: 'tasks/root' },
  routes: [
    { path: '', name: 'tasks:list', component: TasksScreen },
  ],
  widgets: [
    { id: 'today', title: 'Задачи на сегодня', component: TodayTasksWidget, order: 20 },
  ],
  /**
   * Строка с датой, проектом или приоритетом — задача, и модуль узнаёт это сам.
   *
   * Предложение появляется только тогда, когда разбор нашёл ХОТЬ ЧТО-ТО сверх
   * голого текста: иначе любая фраза выглядела бы задачей, и старт предлагал
   * бы завести задачу из «прочитать про Peritext», которому место в инбоксе.
   */
  capture: (ctx, text) => {
    const parsed = parseQuickTask(text);
    const marked = parsed.dueAt !== undefined
      || parsed.project !== undefined
      || parsed.priority !== undefined;
    if (!marked || parsed.title === '') return null;

    const hints = [
      parsed.dueAt === undefined ? null : dayTitle(parsed.dueAt),
      parsed.project === undefined ? null : `#${parsed.project}`,
      parsed.priority === undefined ? null : PRIORITY_LABELS[parsed.priority].toLowerCase(),
    ].filter((part): part is string => part !== null);

    return {
      title: `Задача: ${parsed.title}`,
      hint: hints.join(' · '),
      run: () => {
        ctx.space.edit(() => {
          const root = ctx.space.root(TasksModel);
          const orders = root.tasks.keys().map(id => readTask(id, root.tasks(id)).order);
          const task = createTask(parsed, { id: newId(), at: Date.now(), order: nextOrder(orders) });
          writeTask(root.tasks(task.id), task);
        });
        return { name: 'tasks:list' };
      },
    };
  },

  /**
   * Команды не переходят по маршрутам, а оставляют заявку экрану (см.
   * `screens/view.ts`): роутером владеет оболочка, и `ModuleContext` отдаёт
   * модулю только его пространство.
   */
  commands: [
    {
      id: 'new',
      title: 'Новая задача',
      keywords: ['todo', 'добавить', 'инбокс'],
      run: () => {
        requestView({ panel: 'inbox', compose: true });
        // Заявку забирает экран задач при монтировании: без перехода она
        // повисала бы, когда команду позвали с чужого экрана.
        return '/tasks';
      },
    },
    ...BUCKETS.map(bucket => ({
      id: bucket,
      title: `Задачи: ${BUCKET_LABELS[bucket].toLocaleLowerCase('ru')}`,
      keywords: [bucket],
      run: () => {
        requestView({ panel: bucket });
      },
    })),
    {
      id: OVERVIEW,
      title: 'Задачи: обзор',
      keywords: ['сводка', 'просрочено', 'статистика'],
      run: () => {
        requestView({ panel: OVERVIEW });
      },
    },
  ],
  search(ctx, query) {
    const root = ctx.space.root(TasksModel);
    const today = todayISO();

    const hits = root.tasks.keys()
      .map(id => readTask(id, root.tasks(id)))
      .filter(task => matchesQuery(task, query));

    // Порядок как у «Сегодня»: невыполненные выше, ближний срок раньше.
    return sortTasks(hits, 'today').slice(0, SEARCH_LIMIT).map(task => ({
      id: task.id,
      title: task.title,
      subtitle: subtitleOf(task, today),
      to: `/${MODULE_ID}?${new URLSearchParams({ bucket: bucketOf(task, today), task: task.id }).toString()}`,
    }));
  },
});

/**
 * Подпись в выдаче палитры: корзина, срок, приоритет и прогресс чек-листа.
 *
 * Точками в одну строку, потому что палитра рисует ровно одну строку под
 * заголовком: всё, что в неё не поместилось, обрежется, — и порядок здесь и
 * есть приоритет показа.
 */
function subtitleOf(task: Task, today: string): string {
  const parts: string[] = [BUCKET_LABELS[bucketOf(task, today)]];
  if (task.dueAt !== undefined) parts.push(dayTitle(task.dueAt, today));
  if (isNotable(task.priority) && task.priority !== undefined) parts.push(PRIORITY_LABELS[task.priority]);
  const progress = progressOf(task.steps);
  if (progress.total > 0) parts.push(`${progress.done}/${progress.total}`);
  return parts.join(' · ');
}
