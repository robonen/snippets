import { lastDays, toISODate } from '@brain/std';
import { bucketOf, isDone, isOverdue } from './task';
import type { Task } from './task';

/**
 * Сводка по списку задач: сколько горит, сколько на сегодня, сколько закрыто за
 * неделю и как всё это разложено по проектам.
 *
 * Чистая функция от снимка и сегодняшнего дня — ровно как `bucketOf`, и по той
 * же причине: сводка НЕ ХРАНИТСЯ. Счётчик в ленде разошёлся бы с задачами на
 * первом же слиянии (одно устройство закрыло дело, второе его удалило), а
 * пересчитать сотню объектов дешевле, чем чинить такой счётчик.
 *
 * Один проход по списку, а не пять фильтров: проходов ровно столько, сколько
 * нужно, и на снимке в сотни задач сводка считается за доли миллисекунды.
 */

/** Сколько дней считаем «неделей» в строке «сделано за неделю». */
const WEEK_DAYS = 7;

export interface ProjectStat {
  /** Идентификатор проекта; `undefined` — задачи вне проектов. */
  project?: string;
  open: number;
  overdue: number;
  /** Закрыто за последнюю неделю. */
  done: number;
}

export interface Overview {
  /** Всего невыполненных. */
  open: number;
  overdue: number;
  /** Невыполненные с сегодняшним сроком — просроченные СЮДА НЕ ВХОДЯТ. */
  today: number;
  doneWeek: number;
  /** Разбивка по проектам; задачи вне проектов идут одной строкой без `project`. */
  projects: ProjectStat[];
}

/**
 * Просроченные не попадают в «на сегодня» намеренно, хотя корзина у них одна.
 *
 * Плитки читают рядом, и «3 просрочено / 3 на сегодня» при трёх задачах — это
 * не сводка, а загадка. Разведённые счётчики отвечают на разные вопросы: что
 * горит и что запланировано на день.
 */
export function overviewOf(tasks: readonly Task[], today: string): Overview {
  const from = lastDays(WEEK_DAYS, today)[0] ?? today;
  const stats = new Map<string, ProjectStat>();

  let open = 0;
  let overdue = 0;
  let dueToday = 0;
  let doneWeek = 0;

  for (const task of tasks) {
    const stat = statOf(stats, task.project);
    const done = isDone(task);

    if (done) {
      if (closedSince(task, from)) {
        doneWeek++;
        stat.done++;
      }
      continue;
    }

    open++;
    stat.open++;

    if (isOverdue(task, today)) {
      overdue++;
      stat.overdue++;
    }
    else if (bucketOf(task, today) === 'today') {
      dueToday++;
    }
  }

  return { open, overdue, today: dueToday, doneWeek, projects: sortStats(stats) };
}

/** Закрыта ли задача не раньше дня `from`. День, а не миллисекунда: неделя считается днями. */
function closedSince(task: Task, from: string): boolean {
  if (task.doneAt === undefined) return false;
  return toISODate(new Date(task.doneAt)) >= from;
}

/** «Сделано из запланированного на день» — полоса прогресса виджета «Сегодня». */
export interface DayProgress {
  done: number;
  total: number;
}

/**
 * Итог дня: закрытые СЕГОДНЯ плюс всё, что на сегодня ещё осталось.
 *
 * Закрытые считаются по дню отметки, а не по остатку списка: дело, закрытое
 * утром, из «Сегодня» уже ушло, и полоса без него показывала бы ноль человеку,
 * который весь день работал. Просроченные входят в знаменатель — они такая же
 * работа на сегодня, только опоздавшая.
 */
export function dayProgress(tasks: readonly Task[], today: string): DayProgress {
  let done = 0;
  let left = 0;

  for (const task of tasks) {
    if (task.doneAt !== undefined) {
      if (toISODate(new Date(task.doneAt)) === today) done++;
      continue;
    }
    if (bucketOf(task, today) === 'today') left++;
  }

  return { done, total: done + left };
}

/**
 * Ключ карты — строка, а `project` в статистике — `undefined` для задач вне
 * проектов: `Map` с ключом `undefined` работает, но тогда порядок обхода зависит
 * от того, в каком порядке приехали задачи, а строка даёт стабильный ключ.
 */
const NO_PROJECT = '';

function statOf(stats: Map<string, ProjectStat>, project: string | undefined): ProjectStat {
  const key = project ?? NO_PROJECT;
  const found = stats.get(key);
  if (found !== undefined) return found;

  const stat: ProjectStat = { open: 0, overdue: 0, done: 0 };
  if (project !== undefined) stat.project = project;
  stats.set(key, stat);
  return stat;
}

/**
 * Порядок: где горит — выше, дальше по объёму работы. Задачи вне проектов при
 * равенстве уходят вниз: это не проект, а остаток, и стоять во главе сводки он
 * не должен. Сравнение доходит до ключа, чтобы порядок был полным и одинаковым
 * на всех устройствах.
 *
 * Пустые строки (проект, у которого всё закрыто больше недели назад) не
 * выбрасываются: исчезнувший из сводки проект выглядит как потерянный.
 */
function sortStats(stats: Map<string, ProjectStat>): ProjectStat[] {
  return [...stats.entries()]
    .sort(([leftKey, a], [rightKey, b]) => (
      b.overdue - a.overdue
      || b.open - a.open
      || b.done - a.done
      || Number(leftKey === NO_PROJECT) - Number(rightKey === NO_PROJECT)
      || leftKey.localeCompare(rightKey)
    ))
    .map(([, stat]) => stat);
}
