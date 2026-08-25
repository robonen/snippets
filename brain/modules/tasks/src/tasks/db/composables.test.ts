import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Land, Link, createSpace, fixedClock } from '@sync/core';
import type { Doc, Space } from '@sync/core';
import { useActions } from './composables';
import { TasksModel, readTask } from './models';

/**
 * Действия проверяются на НАСТОЯЩЕМ пространстве, а не на моках: хук берёт
 * пространство параметром (так же, как виджет «Сегодня»), поэтому запись можно
 * прогнать без компонента и без DOM. Читаем результат снимками — не через
 * реактивный хук: тест про запись не должен зависеть от того, в каком кадре
 * файбер обновит Vue-реф.
 */
function spaceOf(): Space {
  const land = new Land(Link.peer(new Uint8Array(8).fill(0x55)), fixedClock(1_700_000));
  return createSpace({ land });
}

function tasksOf(space: Space): ReadonlyArray<ReturnType<typeof readTask>> {
  const root: Doc<'tasks/root'> = space.root(TasksModel);
  return root.tasks.keys().map(id => readTask(id, root.tasks(id)));
}

const NOW = new Date('2026-08-24T09:00:00');

beforeEach(() => {
  // Действия зовут `Date.now()` сами — иначе «сегодня» в тесте плавало бы.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('task actions', () => {
  it('adds a task and puts it at the end of the manual order', () => {
    const space = spaceOf();
    const actions = useActions(space);

    const first = actions.add({ title: 'Купить хлеб' });
    const second = actions.add({ title: 'Полить цветы', dueAt: '2026-08-25' });

    expect(second.order).toBeGreaterThan(first.order);
    expect(tasksOf(space)).toHaveLength(2);
    expect(readTask(first.id, space.root(TasksModel).tasks(first.id))).toEqual(first);
  });

  it('completing a recurring task spawns the next one, the completed one remains', () => {
    const space = spaceOf();
    const actions = useActions(space);

    const source = actions.add({
      title: 'Полить цветы',
      dueAt: '2026-08-24',
      repeat: { unit: 'day', every: 3, enabled: true },
    });
    actions.setDone(source.id, true);

    const all = tasksOf(space);
    expect(all).toHaveLength(2);

    const done = all.find(task => task.id === source.id);
    expect(done?.doneAt).toBe(NOW.getTime());

    const next = all.find(task => task.id !== source.id);
    expect(next?.dueAt).toBe('2026-08-27');
    expect(next?.title).toBe('Полить цветы');
    expect(next?.repeat).toEqual({ unit: 'day', every: 3, enabled: true });
    expect(Object.hasOwn(next ?? {}, 'doneAt')).toBeFalsy();
  });

  it('completing an ordinary task spawns nothing, reverting clears the mark', () => {
    const space = spaceOf();
    const actions = useActions(space);

    const task = actions.add({ title: 'Позвонить в банк' });
    actions.setDone(task.id, true);
    expect(tasksOf(space)).toHaveLength(1);

    actions.setDone(task.id, false);
    expect(Object.hasOwn(tasksOf(space)[0] ?? {}, 'doneAt')).toBeFalsy();
  });

  it('deleting a project unlinks its tasks', () => {
    const space = spaceOf();
    const actions = useActions(space);

    const project = actions.addProject('  Дом  ');
    expect(project?.name).toBe('Дом');

    const task = actions.add({ title: 'Помыть окна', project: project?.id });
    expect(readTask(task.id, space.root(TasksModel).tasks(task.id)).project).toBe(project?.id);

    actions.removeProject(project?.id ?? '');
    expect(space.root(TasksModel).projects.size()).toBe(0);
    expect(Object.hasOwn(tasksOf(space)[0] ?? {}, 'project')).toBeFalsy();
  });

  it('project without a name is not created', () => {
    expect(useActions(spaceOf()).addProject('   ')).toBeNull();
  });

  it('deletion returns a snapshot, and it restores the task under the same id', () => {
    const space = spaceOf();
    const actions = useActions(space);

    const task = actions.add({
      title: 'Отменить подписку',
      dueAt: '2026-08-25',
      priority: 'high',
      steps: [{ id: 's1', title: 'Найти письмо', order: 1 }],
    });

    const removed = actions.remove(task.id);
    expect(removed).toEqual(task);
    expect(tasksOf(space)).toHaveLength(0);
    // Пункты уходят вместе с задачей: надгробие на ключе каталога поддерево за
    // собой не уносит, и без явной очистки они остались бы мусором в ленде.
    expect(space.root(TasksModel).tasks(task.id).steps.size()).toBe(0);

    actions.restore(removed ?? task);
    // Тот же идентификатор: ссылка из поиска и заявка экрана держат именно его.
    expect(tasksOf(space)).toEqual([task]);
  });

  it('nothing to delete — nothing to return', () => {
    expect(useActions(spaceOf()).remove('нет-такой')).toBeNull();
  });

  it('checking a checklist item touches no siblings and does not close the task', () => {
    const space = spaceOf();
    const actions = useActions(space);

    const task = actions.add({
      title: 'Собраться в поход',
      steps: [
        { id: 's1', title: 'Палатка', order: 1 },
        { id: 's2', title: 'Батарейки', order: 2 },
      ],
    });

    actions.setStepDone(task.id, 's1', true);
    const marked = tasksOf(space)[0];
    expect(marked?.steps?.[0]?.doneAt).toBe(NOW.getTime());
    expect(Object.hasOwn(marked?.steps?.[1] ?? {}, 'doneAt')).toBeFalsy();
    expect(Object.hasOwn(marked ?? {}, 'doneAt')).toBeFalsy();

    actions.setStepDone(task.id, 's1', false);
    expect(Object.hasOwn(tasksOf(space)[0]?.steps?.[0] ?? {}, 'doneAt')).toBeFalsy();
  });

  it('completing a repeat with a checklist spawns a task with clean items and NEW keys', () => {
    const space = spaceOf();
    const actions = useActions(space);

    const source = actions.add({
      title: 'Постирать форму',
      dueAt: '2026-08-24',
      repeat: { unit: 'week', every: 1, enabled: true },
      steps: [{ id: 's1', title: 'Собрать', order: 1 }],
    });
    actions.setStepDone(source.id, 's1', true);
    actions.setDone(source.id, true);

    const next = tasksOf(space).find(item => item.id !== source.id);
    expect(next?.dueAt).toBe('2026-08-31');
    expect(next?.steps).toHaveLength(1);
    expect(next?.steps?.[0]?.title).toBe('Собрать');
    expect(Object.hasOwn(next?.steps?.[0] ?? {}, 'doneAt')).toBeFalsy();
    // Ключ обязан быть своим: каталог у новой задачи собственный.
    expect(next?.steps?.[0]?.id).not.toBe('s1');
  });

  it('project is renamed, an empty name leaves it alone', () => {
    const space = spaceOf();
    const actions = useActions(space);

    const project = actions.addProject('Дом');
    actions.renameProject(project?.id ?? '', '  Квартира  ');
    expect(space.root(TasksModel).projects(project?.id ?? '').name()).toBe('Квартира');

    actions.renameProject(project?.id ?? '', '   ');
    expect(space.root(TasksModel).projects(project?.id ?? '').name()).toBe('Квартира');
  });

  it('editing a nonexistent task creates nothing', () => {
    const space = spaceOf();
    const actions = useActions(space);

    actions.save({
      id: 'нет-такой',
      title: 'Призрак',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
      order: 1,
    });
    actions.setDone('нет-такой', true);

    expect(tasksOf(space)).toHaveLength(0);
  });
});
