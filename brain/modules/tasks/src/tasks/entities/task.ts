import { shiftISODate, toISODate, todayISO } from '@brain/std';
import { DEFAULT_PRIORITY, comparePriority } from './priority';
import type { Priority } from './priority';
import { nextAfter, normalizeRepeat, sameRepeat } from './repeat';
import type { RepeatRule } from './repeat';
import { resetSteps, sameSteps, sortSteps } from './step';
import type { Step } from './step';

/**
 * Задача GTD-lite и раскладка по корзинам.
 *
 * ГЛАВНОЕ РЕШЕНИЕ: корзина НЕ ХРАНИТСЯ. «Выполнено» живёт в `doneAt`,
 * «сегодня» и «запланировано» — в `dueAt`, и хранить их ещё и полем статуса
 * значило бы завести второй источник правды. Он разойдётся не «когда-нибудь», а
 * гарантированно: наступает полночь, и задача со вчерашним сроком обязана
 * переехать из «Запланировано» в «Сегодня» — сама, без миграции, которую некому
 * запустить на выключенном телефоне. Поле, которое пришлось бы переписывать по
 * будильнику, — это не данные, а кэш вычисления.
 *
 * Поэтому `status` хранит РОВНО ТО, что из полей не выводится: сознательное
 * «когда-нибудь». У отложенного дела нет ни даты, ни отметки о выполнении —
 * отличить его от неразобранного инбокса можно только по намерению, и это
 * намерение приходится записать.
 */

/** Отношение к задаче: обычная работа или сознательно отложенная. */
export type TaskStance = 'active' | 'someday';

export const STANCES: readonly TaskStance[] = ['active', 'someday'];

export interface Task {
  id: string;
  title: string;
  note?: string;
  status: TaskStance;
  /** Идентификатор проекта; отсутствует у задач вне проектов. */
  project?: string;
  /** Срок — локальная дата YYYY-MM-DD: у дела есть день, а не миллисекунда. */
  dueAt?: string;
  /** Момент выполнения. Есть ⇔ задача выполнена. */
  doneAt?: number;
  /** Ступень важности. Отсутствие равно «обычному» — см. `priority.ts`. */
  priority?: Priority;
  /** Чек-лист внутри задачи. Пустого массива не бывает: нет пунктов — нет поля. */
  steps?: Step[];
  repeat?: RepeatRule;
  createdAt: number;
  updatedAt: number;
  /** Место в ручном порядке внутри корзины. Больше — ниже. */
  order: number;
}

/** Заготовка новой задачи: всё, что не задаёт пользователь, доставляет `createTask`. */
export interface TaskDraft {
  title: string;
  note?: string;
  status?: TaskStance;
  project?: string;
  dueAt?: string;
  priority?: Priority;
  steps?: readonly Step[];
  repeat?: RepeatRule;
}

/** Чем задача становится в момент рождения: ключ, время и место в порядке. */
export interface TaskSeed {
  id: string;
  at: number;
  order: number;
  /**
   * Ключи для пунктов чек-листа — по одному на пункт. Нужны только там, где
   * пункты копируются в НОВУЮ задачу ({@link followUp}): каталог у неё свой, и
   * переиспользованный ключ склеил бы два пункта в один.
   */
  steps?: readonly string[];
}

export type Bucket = 'inbox' | 'today' | 'scheduled' | 'someday' | 'done';

/** Порядок корзин — это и порядок разбора: от неразобранного к закрытому. */
export const BUCKETS: readonly Bucket[] = ['inbox', 'today', 'scheduled', 'someday', 'done'];

export const BUCKET_LABELS: Record<Bucket, string> = {
  inbox: 'Инбокс',
  today: 'Сегодня',
  scheduled: 'Запланировано',
  someday: 'Когда-нибудь',
  done: 'Выполнено',
};

export const BUCKET_HINTS: Record<Bucket, string> = {
  inbox: 'Сюда падает всё, что ещё не разобрано. Поставьте срок или отложите на «когда-нибудь».',
  today: 'На сегодня ничего не назначено. Просроченные дела тоже приходят сюда.',
  scheduled: 'Задачи со сроком в будущем появятся здесь.',
  someday: 'Дела без срока, до которых руки дойдут не сейчас.',
  done: 'Выполненные задачи собираются здесь — вместе с закрытыми повторами.',
};

export function isBucket(value: string): value is Bucket {
  return (BUCKETS as readonly string[]).includes(value);
}

/**
 * Корзина задачи — чистая функция от полей и сегодняшнего дня.
 *
 * Порядок проверок — это и есть правила раскладки:
 * 1. выполненная задача выполнена, чем бы она ни была раньше;
 * 2. ДАТА СИЛЬНЕЕ «когда-нибудь». После слияния двух устройств задача может
 *    оказаться и отложенной, и со сроком (одно устройство отложило, второе
 *    назначило дату). Победа «когда-нибудь» спрятала бы дело со сроком —
 *    пропущенное обязательство; победа даты в худшем случае покажет его рано;
 * 3. просроченное — дело сегодняшнее: `dueAt <= today`, а не `=== today`.
 *    Вчерашний срок, уехавший в «Запланировано», не увидит никто.
 */
export function bucketOf(task: Task, today: string = todayISO()): Bucket {
  if (task.doneAt !== undefined) return 'done';
  if (task.dueAt !== undefined) return task.dueAt <= today ? 'today' : 'scheduled';
  return task.status === 'someday' ? 'someday' : 'inbox';
}

export function isDone(task: Task): boolean {
  return task.doneAt !== undefined;
}

/** Срок в прошлом у невыполненной задачи. Подсвечивается опасным тоном. */
export function isOverdue(task: Task, today: string = todayISO()): boolean {
  return task.doneAt === undefined && task.dueAt !== undefined && task.dueAt < today;
}

/**
 * Чем корзина наполняет новую задачу.
 *
 * Быстрый ввод стоит в открытой корзине, и задача обязана в ней остаться: набрать
 * дело в «Сегодня» и увидеть, как оно улетело в инбокс, — это не «строгая
 * модель», это сломанный ввод. «Запланировано» получает завтрашний день:
 * ближайшая дата, которая в эту корзину попадает.
 */
export function draftFor(bucket: Bucket, today: string = todayISO()): Partial<TaskDraft> {
  if (bucket === 'today') return { dueAt: today };
  if (bucket === 'scheduled') return { dueAt: shiftISODate(today, 1) };
  if (bucket === 'someday') return { status: 'someday' };
  return {};
}

/**
 * Задача из заготовки. Опциональные поля не появляются со значением
 * `undefined`: доменный тип не должен зависеть от того, через какую форму он
 * приехал (та же договорённость, что у снимков в `db/models.ts`).
 */
export function createTask(draft: TaskDraft, seed: TaskSeed): Task {
  const task: Task = {
    id: seed.id,
    title: draft.title.trim(),
    status: draft.status ?? 'active',
    createdAt: seed.at,
    updatedAt: seed.at,
    order: seed.order,
  };
  const note = draft.note?.trim();
  if (note !== undefined && note !== '') task.note = note;
  if (draft.project !== undefined && draft.project !== '') task.project = draft.project;
  if (draft.dueAt !== undefined && draft.dueAt !== '') task.dueAt = draft.dueAt;
  if (draft.priority !== undefined && draft.priority !== DEFAULT_PRIORITY) task.priority = draft.priority;
  if (draft.steps !== undefined && draft.steps.length > 0) task.steps = sortSteps(draft.steps);
  const repeat = normalizeRepeat(draft.repeat);
  if (repeat !== undefined) task.repeat = repeat;
  return task;
}

/** Следующее место в ручном порядке: новая задача встаёт в конец. */
export function nextOrder(orders: readonly number[]): number {
  let max = 0;
  for (const order of orders) max = Math.max(max, order);
  return max + 1;
}

/**
 * Следующее вхождение повторяющейся задачи — или `null`, если повтора нет.
 *
 * Рождается НОВАЯ задача, а выполненная остаётся в «Выполнено». Перенос той же
 * задачи на новую дату стёр бы историю серии: «мыл окна» превратилось бы в одну
 * строку, которая всегда впереди и никогда не сделана.
 *
 * Отсчёт идёт от собственного срока задачи (у бессрочной — от дня выполнения) и
 * догоняет сегодня шагами правила, чтобы ритм «5-го числа» пережил опоздание.
 *
 * Чек-лист переезжает ПУСТЫМ: пункты — это шаги одного прохода, и «собрать сумку
 * в зал», приехавшее на следующую неделю уже со всеми галочками, выглядит
 * сделанным, не будучи им.
 */
export function followUp(task: Task, seed: TaskSeed): Task | null {
  const doneOn = toISODate(new Date(seed.at));
  const due = nextAfter(task.repeat, task.dueAt ?? doneOn, doneOn);
  if (due === null) return null;

  const { doneAt: _doneAt, ...open } = task;
  const next: Task = { ...open, id: seed.id, dueAt: due, createdAt: seed.at, updatedAt: seed.at, order: seed.order };
  if (task.steps !== undefined) next.steps = resetSteps(task.steps, seed.steps ?? []);
  return next;
}

/** Сколько ключей понадобится {@link followUp} для чек-листа этой задачи. */
export function followUpSteps(task: Task): number {
  return task.steps?.length ?? 0;
}

/**
 * Одинаковы ли задачи по существу — всё, кроме `updatedAt`.
 *
 * Нужно ровно в одном месте: лист правки закрывается и без правок. Запись
 * равного значения юнитов не порождает, но новый `updatedAt` — значение НЕ
 * равное, и одно открытие формы оставляло бы след в ленде.
 */
export function sameTask(a: Task, b: Task): boolean {
  return a.id === b.id
    && a.title === b.title
    && a.note === b.note
    && a.status === b.status
    && a.project === b.project
    && a.dueAt === b.dueAt
    && a.doneAt === b.doneAt
    && (a.priority ?? DEFAULT_PRIORITY) === (b.priority ?? DEFAULT_PRIORITY)
    && a.order === b.order
    && a.createdAt === b.createdAt
    && sameRepeat(a.repeat, b.repeat)
    && sameSteps(a.steps, b.steps);
}

/**
 * Поиск по заголовку, заметке и пунктам чек-листа. Пустой запрос не совпадает ни
 * с чем.
 *
 * Пункты ищутся тоже: «купить батарейки» вполне может быть третьим шагом дела
 * «собраться в поход», и не находить его значило бы прятать половину списка.
 */
export function matchesQuery(task: Task, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('ru');
  if (needle === '') return false;
  if (task.title.toLocaleLowerCase('ru').includes(needle)) return true;
  if (task.note !== undefined && task.note.toLocaleLowerCase('ru').includes(needle)) return true;
  return task.steps?.some(step => step.title.toLocaleLowerCase('ru').includes(needle)) === true;
}

/**
 * Порядок внутри корзины.
 *
 * ПРИОРИТЕТ СРАВНИВАЕТСЯ ПОСЛЕ СРОКА, а не до него. Срок — это обещание с
 * датой, приоритет — мнение о важности; «срочная» задача на пятницу, вставшая
 * выше просроченной, спрятала бы то, что уже горит. Зато в корзинах без дат
 * (инбокс, «когда-нибудь») сроки одинаковы, сравнение по ним нулевое — и
 * приоритет становится главным, ради чего он и заведён.
 *
 * Сравнение доходит до `id` намеренно: порядок обязан быть ПОЛНЫМ. Снимок
 * коллекции приезжает в порядке ключей ленда, и на двух устройствах он разный —
 * без последнего сравнения два одинаковых набора задач рисовались бы в разном
 * порядке, а строки прыгали бы при каждом слиянии.
 */
export function sortTasks(tasks: readonly Task[], bucket: Bucket = 'inbox'): Task[] {
  return [...tasks].sort(compareIn(bucket));
}

function compareIn(bucket: Bucket): (a: Task, b: Task) => number {
  return (a, b) => {
    // Невыполненные выше выполненных: в чистой корзине это нулевое сравнение, а
    // в смешанном списке (выдача поиска) — единственное, что важно.
    const byDone = Number(isDone(a)) - Number(isDone(b));
    if (byDone !== 0) return byDone;

    if (bucket === 'done') {
      // В закрытых приоритет не значит ничего: важность влияла на очередь, а
      // очереди больше нет — есть журнал, и он читается от свежего к старому.
      const byRecent = (b.doneAt ?? 0) - (a.doneAt ?? 0);
      if (byRecent !== 0) return byRecent;
    }
    else {
      // ISO-даты сравниваются лексикографически ровно как хронологически.
      const byDue = compareDue(a.dueAt, b.dueAt);
      if (byDue !== 0) return byDue;

      const byPriority = comparePriority(a.priority, b.priority);
      if (byPriority !== 0) return byPriority;
    }

    if (a.order !== b.order) return a.order - b.order;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id.localeCompare(b.id);
  };
}

/** Бессрочные — в хвост: у них нет обязательства, которое торопит. */
function compareDue(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a < b ? -1 : 1;
}
