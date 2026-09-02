import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { useDoc, useSpace, useValue } from '@sync/vue';
import type { Space } from '@sync/core';
import { sortProjects } from '../entities/project';
import { setStepDone } from '../entities/step';
import { createTask, followUp, followUpSteps, nextOrder, sortTasks } from '../entities/task';
import type { Project } from '../entities/project';
import type { Task, TaskDraft } from '../entities/task';
import { newId } from '@brain/module-kit';
import { TasksModel, readProject, readTask, writeProject, writeTask } from './models';

/**
 * Хуки задач поверх моста `@sync/vue`.
 *
 * Снимок целой коллекции, а не подписка на строку: личный список — это сотни
 * задач, и один файбер на коллекцию дешевле файбера на строку. Важнее другое:
 * корзина считается от СЕГОДНЯШНЕГО дня, а сегодняшний день живёт на Vue-рефе —
 * файберный наблюдатель его не видит, и фильтр обязан считаться на стороне Vue.
 *
 * Необязательное `space` — для виджета «Сегодня»: оболочка рисует его вне хоста
 * модуля, инъекции `@sync/vue` там нет, и пространство приходит явно из кита.
 */

export function useTasks(space?: Space): ComputedRef<Task[]> {
  const root = useDoc(TasksModel, undefined, space);
  const snapshot = useValue(() => root.tasks.keys().map(id => readTask(id, root.tasks(id))));
  return computed(() => sortTasks(snapshot.value ?? []));
}

export function useProjects(space?: Space): ComputedRef<Project[]> {
  const root = useDoc(TasksModel, undefined, space);
  const snapshot = useValue(() => root.projects.keys().map(id => readProject(id, root.projects(id))));
  return computed(() => sortProjects(snapshot.value ?? []));
}

// ── Запись ───────────────────────────────────────────────────────────────────
// Мутаций как понятия нет: запись — прямой вызов каналов в транзакции
// (`space.edit`: одна метка времени и один сброс на всё). Оптимистичность
// бесплатна — запись сразу локальная и настоящая, откатывать нечего.

export interface TasksActions {
  add(draft: TaskDraft): Task;
  /** Сохранить задачу целиком — форма правки приезжает одним объектом. */
  save(task: Task): void;
  /** Отметить выполненной или вернуть в работу; повтор рождает следующую. */
  setDone(id: string, done: boolean): void;
  /**
   * Удалить задачу и вернуть её снимок — им же её и возвращают ({@link restore}).
   * `null` — удалять было нечего.
   */
  remove(id: string): Task | null;
  /**
   * Вернуть удалённую задачу под тем же идентификатором: «Отменить» в тосте.
   *
   * Тем же, а не новым: ссылка из поиска, открытая вкладка и заявка экрана
   * (`/tasks?task=…`) держат именно его, и подмена ключа превратила бы отмену
   * удаления в создание похожей задачи.
   */
  restore(task: Task): void;
  /** Отметить пункт чек-листа прямо из списка — не открывая форму правки. */
  setStepDone(taskId: string, stepId: string, done: boolean): void;
  /** `null` — пустое имя: проект без имени неотличим от остальных таких же. */
  addProject(name: string): Project | null;
  renameProject(id: string, name: string): void;
  removeProject(id: string): void;
}

export function useActions(space?: Space): TasksActions {
  const host = space ?? useSpace();
  const root = useDoc(TasksModel, undefined, host);

  /** Порядок читается из ленда, а не из снимка: снимок мог отстать на кадр. */
  const orders = (): number[] => root.tasks.keys().map(id => root.tasks(id).order());

  /** Ключи для пунктов следующего вхождения повтора: каталог у него свой. */
  const stepIds = (count: number): string[] => Array.from({ length: count }, () => newId());

  return {
    add(draft) {
      const at = Date.now();
      return host.edit(() => {
        const task = createTask(draft, { id: newId(), at, order: nextOrder(orders()) });
        writeTask(root.tasks(task.id), task);
        return task;
      });
    },
    save(task) {
      if (!root.tasks.has(task.id)) return;
      host.edit(() => {
        writeTask(root.tasks(task.id), task);
      });
    },
    setDone(id, done) {
      if (!root.tasks.has(id)) return;
      const at = Date.now();
      host.edit(() => {
        const doc = root.tasks(id);
        const task = readTask(id, doc);
        if (!done) {
          const { doneAt: _doneAt, ...open } = task;
          writeTask(doc, { ...open, updatedAt: at });
          return;
        }
        writeTask(doc, { ...task, doneAt: at, updatedAt: at });
        const next = followUp(task, {
          id: newId(),
          at,
          order: nextOrder(orders()),
          steps: stepIds(followUpSteps(task)),
        });
        if (next !== null) writeTask(root.tasks(next.id), next);
      });
    },
    remove(id) {
      if (!root.tasks.has(id)) return null;
      // Снимок снимается ДО удаления: после него читать уже нечего, а именно он
      // и есть всё, что нужно для отмены.
      const task = readTask(id, root.tasks(id));
      host.edit(() => {
        // Чек-лист вычищается ЯВНО. Надгробие на ключе каталога поддерево за
        // собой не уносит (`Land.remove` намеренно сохраняет `lead` детей), и
        // без этой строки пункты удалённой задачи остались бы в ленде навсегда —
        // недостижимым мусором, который едет по проводу и в хранилище.
        root.tasks(id).steps.clear();
        root.tasks.delete(id);
      });
      return task;
    },
    restore(task) {
      host.edit(() => {
        writeTask(root.tasks(task.id), task);
      });
    },
    setStepDone(taskId, stepId, done) {
      if (!root.tasks.has(taskId)) return;
      const at = Date.now();
      host.edit(() => {
        const doc = root.tasks(taskId);
        const task = readTask(taskId, doc);
        if (task.steps === undefined) return;
        writeTask(doc, { ...task, steps: setStepDone(task.steps, stepId, done, at), updatedAt: at });
      });
    },
    addProject(name) {
      const clean = name.trim();
      if (clean === '') return null;
      const project: Project = { id: newId(), name: clean, createdAt: Date.now() };
      host.edit(() => {
        writeProject(root.projects(project.id), project);
      });
      return project;
    },
    renameProject(id, name) {
      const clean = name.trim();
      // Пустое имя — опечатка, а не переименование в «ничто»: проект без имени
      // неотличим от остальных таких же.
      if (clean === '' || !root.projects.has(id)) return;
      host.edit(() => {
        root.projects(id).name(clean);
      });
    },
    removeProject(id) {
      host.edit(() => {
        // Ссылка на удалённый проект — это фильтр, который ничего не находит, и
        // подпись, которую некому расшифровать. Снимаем её вместе с проектом.
        for (const key of root.tasks.keys()) {
          const doc = root.tasks(key);
          if (doc.project() === id) doc.project(null);
        }
        root.projects.delete(id);
      });
    },
  };
}
