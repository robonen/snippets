import { atom, model, parts, t } from '@sync/core';
import { scoped } from '@brain/module-kit';
import type { Doc } from '@sync/core';
import { DEFAULT_PRIORITY, PRIORITIES } from '../entities/priority';
import { REPEAT_UNITS } from '../entities/repeat';
import { sortSteps } from '../entities/step';
import { STANCES } from '../entities/task';
import type { Project } from '../entities/project';
import type { Step } from '../entities/step';
import type { Task } from '../entities/task';

/**
 * Модели задач на `@sync/core`: схема — данные, документ — объект каналов, поле
 * — атом. Снимки (`readTask`/`writeTask`) переводят документ в плоские доменные
 * типы, и весь расчёт корзин, сортировок и повторов работает с обычными
 * объектами — без ленда и без DOM.
 *
 * Имена моделей несут префикс модуля: реестр `Models` один на приложение, и без
 * префикса `tasks/task` и чей-нибудь ещё `task` молча склеили бы схемы.
 */

/** Имя модуля: из него чеканится адрес ленда и складываются имена моделей. */
export const MODULE_ID = 'tasks';

const scope = scoped(MODULE_ID);

/**
 * Правило повтора разложено тремя атомами, а не вложенной частью.
 *
 * Слияние от этого не меняется — у части поля сливаются так же, по одному, — а
 * реестр моделей не получает четвёртого имени ради трёх скаляров. `repeatEvery`
 * равный нулю означает «правила нет»: единственное значение, которое правилом
 * быть не может (см. `normalizeRepeat`).
 */
/**
 * Пункт чек-листа — собственная модель, а не строка в списке задачи.
 *
 * Список строк («сделано|Купить молока») слился бы неправильно: два устройства,
 * отметившие РАЗНЫЕ пункты, переписывают один и тот же элемент массива, и
 * победитель LWW уносит чужую отметку. У отдельного документа каждая отметка —
 * свой атом в своём поддереве, и оба устройства остаются правы.
 */
export const StepModel = model(scope('step'), {
  title: atom(t.string),
  doneAt: atom(t.maybe(t.number)),
  order: atom(t.number),
});

export const TaskModel = model(scope('task'), {
  title: atom(t.string),
  note: atom(t.string),
  status: atom(t.enum(STANCES).or('active')),
  priority: atom(t.enum(PRIORITIES).or(DEFAULT_PRIORITY)),
  project: atom(t.maybe(t.string)),
  dueAt: atom(t.maybe(t.string)),
  doneAt: atom(t.maybe(t.number)),
  /** Чек-лист живёт В ПОДДЕРЕВЕ задачи: удалили задачу — пункты ушли с ней. */
  steps: parts(t.string, 'tasks/step'),
  repeatEvery: atom(t.int),
  repeatUnit: atom(t.enum(REPEAT_UNITS).or('day')),
  repeatOn: atom(t.bool),
  createdAt: atom(t.number),
  updatedAt: atom(t.number),
  order: atom(t.number),
});

export const ProjectModel = model(scope('project'), {
  name: atom(t.string),
  createdAt: atom(t.number),
});

/** Корень ленда: два каталога по id. */
export const TasksModel = model(scope('root'), {
  tasks: parts(t.string, 'tasks/task'),
  projects: parts(t.string, 'tasks/project'),
});

declare module '@sync/core' {
  interface Models {
    'tasks/step': typeof StepModel;
    'tasks/task': typeof TaskModel;
    'tasks/project': typeof ProjectModel;
    'tasks/root': typeof TasksModel;
  }
}

export type TasksDoc = Doc<'tasks/root'>;

// ── Снимки: документ → доменный тип ──────────────────────────────────────────
// Опциональность домена (`undefined`) отображается в `null` модели и обратно: у
// каналов один сентинел (docs/05, решение Р6). У заметки сентинел не нужен —
// разницы между «пустая» и «нет» у неё не бывает.

export function readTask(id: string, doc: Doc<'tasks/task'>): Task {
  const task: Task = {
    id,
    title: doc.title(),
    status: doc.status(),
    createdAt: doc.createdAt(),
    updatedAt: doc.updatedAt(),
    order: doc.order(),
  };
  const note = doc.note();
  if (note !== '') task.note = note;
  const priority = doc.priority();
  // «Обычный» — значение по умолчанию: не хранить его в снимке значит, что
  // задача, никогда не видевшая приоритета, и задача, которой его вернули,
  // сравниваются равными (гейт `sameTask`).
  if (priority !== DEFAULT_PRIORITY) task.priority = priority;
  const project = doc.project();
  if (project !== null) task.project = project;
  const dueAt = doc.dueAt();
  if (dueAt !== null) task.dueAt = dueAt;
  const doneAt = doc.doneAt();
  if (doneAt !== null) task.doneAt = doneAt;
  const steps = readSteps(doc);
  if (steps.length > 0) task.steps = steps;
  const every = doc.repeatEvery();
  if (every > 0) task.repeat = { unit: doc.repeatUnit(), every, enabled: doc.repeatOn() };
  return task;
}

export function readStep(id: string, doc: Doc<'tasks/step'>): Step {
  const step: Step = { id, title: doc.title(), order: doc.order() };
  const doneAt = doc.doneAt();
  if (doneAt !== null) step.doneAt = doneAt;
  return step;
}

/** Пункты приезжают уже в своём порядке: сортировать их каждому экрану незачем. */
function readSteps(doc: Doc<'tasks/task'>): Step[] {
  return sortSteps(doc.steps.keys().map(key => readStep(key, doc.steps(key))));
}

export function readProject(id: string, doc: Doc<'tasks/project'>): Project {
  return { id, name: doc.name(), createdAt: doc.createdAt() };
}

// ── Запись: доменный тип → документ ──────────────────────────────────────────
// Запись равного значения юнитов не порождает (гейт S4), поэтому «сохранить
// форму целиком» — дёшево и не шумит в ленде.

export function writeTask(doc: Doc<'tasks/task'>, task: Task): void {
  doc.title(task.title);
  doc.note(task.note ?? '');
  doc.status(task.status);
  doc.priority(task.priority ?? DEFAULT_PRIORITY);
  doc.project(task.project ?? null);
  doc.dueAt(task.dueAt ?? null);
  doc.doneAt(task.doneAt ?? null);
  writeSteps(doc, task.steps ?? []);
  // Дробное `t.int` не примет и бросит — приводим здесь, на единственной границе
  // между формой и лендом.
  doc.repeatEvery(task.repeat === undefined ? 0 : Math.max(0, Math.trunc(task.repeat.every)));
  doc.repeatUnit(task.repeat?.unit ?? 'day');
  doc.repeatOn(task.repeat?.enabled === true);
  doc.createdAt(task.createdAt);
  doc.updatedAt(task.updatedAt);
  doc.order(task.order);
}

export function writeStep(doc: Doc<'tasks/step'>, step: Step): void {
  doc.title(step.title);
  doc.doneAt(step.doneAt ?? null);
  doc.order(step.order);
}

/**
 * Сохранить чек-лист целиком: что есть в форме — записать, чего нет — удалить.
 *
 * Именно удалить, а не «оставить как было»: форма правки — единственный владелец
 * списка на время редактирования, и пункт, стёртый в ней, обязан исчезнуть из
 * ленда. Ключи, которых в форме нет, собираются заранее — удалять из каталога,
 * по которому идёт обход, нельзя.
 */
function writeSteps(doc: Doc<'tasks/task'>, steps: readonly Step[]): void {
  const keep = new Set(steps.map(step => step.id));
  for (const key of doc.steps.keys()) {
    if (!keep.has(key)) doc.steps.delete(key);
  }
  for (const step of steps) writeStep(doc.steps(step.id), step);
}

export function writeProject(doc: Doc<'tasks/project'>, project: Project): void {
  doc.name(project.name);
  doc.createdAt(project.createdAt);
}
