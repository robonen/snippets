import { describe, expect, it } from 'vitest';
import { Land, Link, createSpace, fixedClock } from '@sync/core';
import type { Space } from '@sync/core';
import type { Project } from '../entities/project';
import type { Task } from '../entities/task';
import { TasksModel, readProject, readTask, writeProject, writeTask } from './models';

function spaceOf(): Space {
  const land = new Land(Link.peer(new Uint8Array(8).fill(0x77)), fixedClock(1_700_000));
  return createSpace({ land });
}

const FULL: Task = {
  id: 't1',
  title: 'Оплатить аренду',
  note: 'Через приложение банка',
  status: 'active',
  priority: 'urgent',
  project: 'p1',
  dueAt: '2026-09-05',
  doneAt: 1_700_500,
  steps: [
    { id: 's1', title: 'Свериться с показаниями', order: 1 },
    { id: 's2', title: 'Перевести', order: 2, doneAt: 1_700_450 },
  ],
  repeat: { unit: 'month', every: 1, enabled: true },
  createdAt: 1_700_100,
  updatedAt: 1_700_400,
  order: 3,
};

const BARE: Task = {
  id: 't2',
  title: 'Разобрать инбокс',
  status: 'someday',
  createdAt: 1_700_200,
  updatedAt: 1_700_200,
  order: 1,
};

describe('task models on @sync/core', () => {
  it('task survives the document → snapshot round-trip together with the repeat', () => {
    const root = spaceOf().root(TasksModel);
    writeTask(root.tasks(FULL.id), FULL);

    expect(readTask(FULL.id, root.tasks(FULL.id))).toEqual(FULL);
  });

  it('empty fields stay absent instead of turning into null', () => {
    const root = spaceOf().root(TasksModel);
    writeTask(root.tasks(BARE.id), BARE);

    const back = readTask(BARE.id, root.tasks(BARE.id));
    expect(back).toEqual(BARE);
    // Доменный тип не меняется из-за смены хранилища: у каналов один сентинел,
    // у домена — отсутствие ключа.
    for (const field of ['note', 'project', 'dueAt', 'doneAt', 'repeat', 'priority', 'steps']) {
      expect(Object.hasOwn(back, field)).toBeFalsy();
    }
  });

  it('disabled rule is stored and read back', () => {
    const root = spaceOf().root(TasksModel);
    const paused: Task = { ...BARE, repeat: { unit: 'week', every: 2, enabled: false } };
    writeTask(root.tasks(paused.id), paused);

    expect(readTask(paused.id, root.tasks(paused.id)).repeat).toEqual({
      unit: 'week',
      every: 2,
      enabled: false,
    });
  });

  it('fractional repeat step does not reach the land: t.int would not accept it', () => {
    const root = spaceOf().root(TasksModel);
    const odd: Task = { ...BARE, repeat: { unit: 'day', every: 2.7, enabled: true } };

    expect(() => {
      writeTask(root.tasks(odd.id), odd);
    }).not.toThrow();
    expect(readTask(odd.id, root.tasks(odd.id)).repeat?.every).toBe(2);
  });

  it('cleared completion mark returns the task to work', () => {
    const root = spaceOf().root(TasksModel);
    writeTask(root.tasks(FULL.id), FULL);

    const { doneAt: _doneAt, ...open } = FULL;
    writeTask(root.tasks(FULL.id), open);
    expect(Object.hasOwn(readTask(FULL.id, root.tasks(FULL.id)), 'doneAt')).toBeFalsy();
  });

  it('catalog keys are visible and deletable', () => {
    const root = spaceOf().root(TasksModel);
    writeTask(root.tasks('a'), { ...BARE, id: 'a' });
    writeTask(root.tasks('b'), { ...BARE, id: 'b', title: 'Полить цветы' });

    expect([...root.tasks.keys()].sort()).toEqual(['a', 'b']);
    root.tasks.delete('a');
    expect([...root.tasks.keys()]).toEqual(['b']);
    expect(root.tasks.has('a')).toBeFalsy();
  });

  it('"normal" priority does not appear in the snapshot: it is the default value', () => {
    const root = spaceOf().root(TasksModel);
    writeTask(root.tasks(BARE.id), { ...BARE, priority: 'normal' });

    expect(Object.hasOwn(readTask(BARE.id, root.tasks(BARE.id)), 'priority')).toBeFalsy();
  });

  it('checklist survives the round-trip and arrives in its order', () => {
    const root = spaceOf().root(TasksModel);
    writeTask(root.tasks(BARE.id), {
      ...BARE,
      steps: [
        { id: 's2', title: 'Второй', order: 2 },
        { id: 's1', title: 'Первый', order: 1, doneAt: 1_700_300 },
      ],
    });

    expect(readTask(BARE.id, root.tasks(BARE.id)).steps).toEqual([
      { id: 's1', title: 'Первый', order: 1, doneAt: 1_700_300 },
      { id: 's2', title: 'Второй', order: 2 },
    ]);
  });

  it('item erased in the form disappears from the land too', () => {
    const root = spaceOf().root(TasksModel);
    const doc = root.tasks(FULL.id);
    writeTask(doc, FULL);
    expect(doc.steps.size()).toBe(2);

    writeTask(doc, { ...FULL, steps: FULL.steps?.slice(0, 1) });
    expect([...doc.steps.keys()]).toEqual(['s1']);

    writeTask(doc, { ...FULL, steps: undefined });
    expect(doc.steps.size()).toBe(0);
    expect(Object.hasOwn(readTask(FULL.id, doc), 'steps')).toBeFalsy();
  });

  it('tombstone on a catalog key does NOT take the subtree — the checklist is cleaned separately', () => {
    // Свойство ядра, а не недосмотр: `Land.remove` сохраняет `lead` детей, иначе
    // надгробие утащило бы за собой всё поддерево и слияние потеряло бы чужие
    // правки внутри него. Отсюда явная очистка в `useActions().remove`.
    const root = spaceOf().root(TasksModel);
    const doc = root.tasks(FULL.id);
    writeTask(doc, FULL);

    root.tasks.delete(FULL.id);
    expect(root.tasks.has(FULL.id)).toBeFalsy();
    expect(doc.steps.size()).toBe(2);

    doc.steps.clear();
    expect(doc.steps.size()).toBe(0);
  });

  it('two tabs check DIFFERENT items — both marks survive', () => {
    // Ради этого чек-лист и сделан каталогом документов, а не списком строк: у
    // списка обе вкладки переписали бы один элемент, и LWW унёс бы чужую отметку.
    const clock = fixedClock(1_700_000);
    const peer = Link.peer(new Uint8Array(8).fill(0x77));
    const tabA = new Land(peer, clock, { session: 0x000100 });
    const tabB = new Land(peer, clock, { session: 0x800100 });

    const rootA = createSpace({ land: tabA }).root(TasksModel);
    const rootB = createSpace({ land: tabB }).root(TasksModel);

    writeTask(rootA.tasks(FULL.id), { ...FULL, steps: [
      { id: 's1', title: 'Первый', order: 1 },
      { id: 's2', title: 'Второй', order: 2 },
    ] });
    tabB.apply(tabA.part().units);

    rootA.tasks(FULL.id).steps('s1').doneAt(1_700_600);
    rootB.tasks(FULL.id).steps('s2').doneAt(1_700_700);

    tabB.apply(tabA.part().units);
    tabA.apply(tabB.part().units);

    for (const root of [rootA, rootB]) {
      const steps = readTask(FULL.id, root.tasks(FULL.id)).steps ?? [];
      expect(steps.map(step => step.doneAt)).toEqual([1_700_600, 1_700_700]);
    }
  });

  it('project survives the document → snapshot round-trip', () => {
    const root = spaceOf().root(TasksModel);
    const project: Project = { id: 'p1', name: 'Дом', createdAt: 1_700_000 };
    writeProject(root.projects(project.id), project);

    expect(readProject(project.id, root.projects(project.id))).toEqual(project);
  });

  it('two tabs converge: a record from one is visible in the other', () => {
    const clock = fixedClock(1_700_000);
    const peer = Link.peer(new Uint8Array(8).fill(0x77));
    const tabA = new Land(peer, clock, { session: 0x000100 });
    const tabB = new Land(peer, clock, { session: 0x800100 });

    const rootA = createSpace({ land: tabA }).root(TasksModel);
    const rootB = createSpace({ land: tabB }).root(TasksModel);

    writeTask(rootA.tasks('x'), { ...FULL, id: 'x' });
    writeProject(rootB.projects('p1'), { id: 'p1', name: 'Дом', createdAt: 1_700_000 });

    // Обмен как по каналу вкладок, только руками и детерминированно.
    tabB.apply(tabA.part().units);
    tabA.apply(tabB.part().units);

    expect(readTask('x', rootB.tasks('x')).title).toBe('Оплатить аренду');
    expect(readProject('p1', rootA.projects('p1')).name).toBe('Дом');
  });
});
