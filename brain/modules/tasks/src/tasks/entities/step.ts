/**
 * Подзадача — пункт чек-листа внутри задачи.
 *
 * Это НЕ задача: у пункта нет ни срока, ни проекта, ни повтора, ни собственной
 * корзины. Дать ему их значило бы получить вторую иерархию — задача с
 * подзадачами со своими подзадачами, — а вместе с ней вопрос «что показывать в
 * „Сегодня“, если срок стоит у пункта, а не у дела». Пункт отвечает ровно на
 * один вопрос: сделан или нет.
 *
 * Отметка хранится моментом (`doneAt`), а не флагом, — как у задачи: одно
 * правило на весь модуль, и «когда именно закрыли» не приходится восстанавливать
 * по `updatedAt` родителя.
 */

export interface Step {
  id: string;
  title: string;
  /** Момент выполнения. Есть ⇔ пункт сделан. */
  doneAt?: number;
  /** Место в ручном порядке. Больше — ниже. */
  order: number;
}

/** Чем пункт становится в момент рождения: ключ, время и место в порядке. */
export interface StepSeed {
  id: string;
  at: number;
  order: number;
}

export function isStepDone(step: Step): boolean {
  return step.doneAt !== undefined;
}

/**
 * Порядок пунктов. Сравнение доходит до `id` по той же причине, что и у задач:
 * снимок каталога приезжает в порядке ключей ленда, а он на двух устройствах
 * разный, и без последнего сравнения пункты прыгали бы при каждом слиянии.
 *
 * Выполненные НЕ уезжают вниз: чек-лист — это последовательность шагов, и
 * переставлять их по ходу выполнения значит терять из виду, что уже пройдено.
 */
export function sortSteps(steps: readonly Step[]): Step[] {
  return [...steps].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Следующее место в ручном порядке: новый пункт встаёт в конец. */
export function nextStepOrder(steps: readonly Step[]): number {
  let max = 0;
  for (const step of steps) max = Math.max(max, step.order);
  return max + 1;
}

/** Пункт из введённой строки. `null` — вводить нечего. */
export function createStep(title: string, seed: StepSeed): Step | null {
  const clean = title.trim();
  if (clean === '') return null;
  return { id: seed.id, title: clean, order: seed.order };
}

/** Добавить пункт в конец. Пустой заголовок список не меняет. */
export function addStep(steps: readonly Step[], title: string, seed: Omit<StepSeed, 'order'>): Step[] {
  const step = createStep(title, { ...seed, order: nextStepOrder(steps) });
  if (step === null) return [...steps];
  return [...steps, step];
}

/** Отметить или снять отметку. Неизвестный `id` список не меняет. */
export function setStepDone(steps: readonly Step[], id: string, done: boolean, at: number): Step[] {
  return steps.map((step) => {
    if (step.id !== id) return step;
    if (!done) {
      const { doneAt: _doneAt, ...open } = step;
      return open;
    }
    return { ...step, doneAt: at };
  });
}

/** Переименовать пункт. Пустое имя — опечатка, а не переименование в «ничто». */
export function renameStep(steps: readonly Step[], id: string, title: string): Step[] {
  const clean = title.trim();
  if (clean === '') return [...steps];
  return steps.map(step => (step.id === id ? { ...step, title: clean } : step));
}

export function removeStep(steps: readonly Step[], id: string): Step[] {
  return steps.filter(step => step.id !== id);
}

/**
 * Снять все отметки — для следующего вхождения повторяющейся задачи.
 *
 * Порядок и заголовки сохраняются: «собрать сумку в зал» повторяется тем же
 * списком, и заново набирать его каждую неделю никто не станет. Идентификаторы
 * пунктов при этом НОВЫЕ — их выдаёт вызывающий, потому что новая задача живёт
 * в собственном каталоге ленда.
 */
export function resetSteps(steps: readonly Step[], ids: readonly string[]): Step[] {
  return sortSteps(steps).map((step, at) => ({
    id: ids[at] ?? step.id,
    title: step.title,
    order: at + 1,
  }));
}

/** Сколько пунктов сделано. `ratio` — доля 0…1, у пустого списка ноль. */
export interface StepProgress {
  done: number;
  total: number;
  ratio: number;
  /** Все пункты закрыты. У пустого списка — `false`: закрывать было нечего. */
  complete: boolean;
}

const NO_PROGRESS: StepProgress = { done: 0, total: 0, ratio: 0, complete: false };

export function progressOf(steps: readonly Step[] | undefined): StepProgress {
  if (steps === undefined || steps.length === 0) return NO_PROGRESS;

  let done = 0;
  for (const step of steps) if (isStepDone(step)) done++;

  const total = steps.length;
  return { done, total, ratio: done / total, complete: done === total };
}

/** Совпадают ли списки по существу. Порядок в массиве значения не имеет. */
export function sameSteps(a: readonly Step[] | undefined, b: readonly Step[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;

  const byId = new Map(right.map(step => [step.id, step]));
  for (const step of left) {
    const other = byId.get(step.id);
    if (other === undefined) return false;
    if (other.title !== step.title || other.doneAt !== step.doneAt || other.order !== step.order) return false;
  }
  return true;
}
