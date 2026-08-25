import { describe, expect, it } from 'vitest';
import {
  BUCKETS,
  bucketOf,
  createTask,
  draftFor,
  followUp,
  followUpSteps,
  isOverdue,
  matchesQuery,
  nextOrder,
  sameTask,
  sortTasks,
} from './task';
import type { Bucket, Task } from './task';

const TODAY = '2026-08-24';

function task(patch: Partial<Task> = {}): Task {
  return {
    id: 'a',
    title: 'Задача',
    status: 'active',
    createdAt: 1_700_000,
    updatedAt: 1_700_000,
    order: 1,
    ...patch,
  };
}

describe('sorting a task into buckets', () => {
  it('no due date and no deferral — inbox', () => {
    expect(bucketOf(task(), TODAY)).toBe('inbox');
  });

  it('due today or overdue — "Today"', () => {
    expect(bucketOf(task({ dueAt: TODAY }), TODAY)).toBe('today');
    expect(bucketOf(task({ dueAt: '2026-08-23' }), TODAY)).toBe('today');
    expect(bucketOf(task({ dueAt: '2020-01-01' }), TODAY)).toBe('today');
  });

  it('due in the future — "Planned"', () => {
    expect(bucketOf(task({ dueAt: '2026-08-25' }), TODAY)).toBe('scheduled');
  });

  it('deferred without a due date — "Someday"', () => {
    expect(bucketOf(task({ status: 'someday' }), TODAY)).toBe('someday');
  });

  it('completed — "Done", whatever it was before', () => {
    expect(bucketOf(task({ doneAt: 1_700_100 }), TODAY)).toBe('done');
    expect(bucketOf(task({ dueAt: '2020-01-01', doneAt: 1_700_100 }), TODAY)).toBe('done');
    expect(bucketOf(task({ status: 'someday', doneAt: 1_700_100 }), TODAY)).toBe('done');
  });

  it('after merge the due date beats "someday": dated work does not hide', () => {
    // Одно устройство отложило задачу, второе назначило ей день — в ленде
    // окажутся оба поля, и раскладка обязана быть предсказуемой.
    expect(bucketOf(task({ status: 'someday', dueAt: '2026-08-25' }), TODAY)).toBe('scheduled');
    expect(bucketOf(task({ status: 'someday', dueAt: '2026-08-23' }), TODAY)).toBe('today');
  });

  it('the bucket changes with the day, not with a write to the land', () => {
    const planned = task({ dueAt: '2026-08-25' });
    expect(bucketOf(planned, '2026-08-24')).toBe('scheduled');
    expect(bucketOf(planned, '2026-08-25')).toBe('today');
    expect(bucketOf(planned, '2026-08-26')).toBe('today');
  });

  it('overdue applies only to the uncompleted', () => {
    expect(isOverdue(task({ dueAt: '2026-08-23' }), TODAY)).toBeTruthy();
    expect(isOverdue(task({ dueAt: TODAY }), TODAY)).toBeFalsy();
    expect(isOverdue(task({ dueAt: '2026-08-23', doneAt: 1 }), TODAY)).toBeFalsy();
    expect(isOverdue(task(), TODAY)).toBeFalsy();
  });
});

describe('new task draft', () => {
  it('property: the task stays in the bucket it was typed in', () => {
    const open = BUCKETS.filter((bucket): bucket is Bucket => bucket !== 'done');
    for (const bucket of open) {
      const created = createTask(
        { title: 'Дело', ...draftFor(bucket, TODAY) },
        { id: 'x', at: 1_700_000, order: 1 },
      );
      expect(bucketOf(created, TODAY)).toBe(bucket);
    }
  });

  it('trims spaces and creates no empty fields', () => {
    const created = createTask({ title: '  Купить хлеб  ', note: '   ' }, { id: 'x', at: 5, order: 2 });
    expect(created.title).toBe('Купить хлеб');
    expect(Object.hasOwn(created, 'note')).toBeFalsy();
    expect(Object.hasOwn(created, 'dueAt')).toBeFalsy();
    expect(created.status).toBe('active');
    expect(created.createdAt).toBe(5);
    expect(created.updatedAt).toBe(5);
  });

  it('invalid repeat rule does not enter the task', () => {
    const created = createTask(
      { title: 'Дело', repeat: { unit: 'day', every: 0, enabled: true } },
      { id: 'x', at: 5, order: 2 },
    );
    expect(Object.hasOwn(created, 'repeat')).toBeFalsy();
  });

  it('next slot in the order is after the last one', () => {
    expect(nextOrder([])).toBe(1);
    expect(nextOrder([1, 7, 3])).toBe(8);
    expect(nextOrder([-4])).toBe(1);
  });
});

describe('next task of a recurring series', () => {
  const at = Date.parse('2026-08-24T10:00:00');

  it('is born as a new task, the completed one stays in history', () => {
    const source = task({ dueAt: '2026-08-24', repeat: { unit: 'day', every: 1, enabled: true } });
    const next = followUp(source, { id: 'b', at, order: 9 });

    expect(next).not.toBeNull();
    expect(next?.id).toBe('b');
    expect(next?.dueAt).toBe('2026-08-25');
    expect(next?.title).toBe(source.title);
    expect(next?.repeat).toEqual(source.repeat);
    expect(next?.order).toBe(9);
    // Наследовать отметку о выполнении новая задача не может — иначе серия
    // мгновенно закрывается сама.
    expect(next === null || Object.hasOwn(next, 'doneAt')).toBeFalsy();
  });

  it('no rule or a disabled rule — no next task', () => {
    expect(followUp(task({ dueAt: '2026-08-24' }), { id: 'b', at, order: 2 })).toBeNull();
    expect(followUp(
      task({ dueAt: '2026-08-24', repeat: { unit: 'day', every: 1, enabled: false } }),
      { id: 'b', at, order: 2 },
    )).toBeNull();
  });

  it('undated recurring task counts from the completion day', () => {
    const source = task({ repeat: { unit: 'week', every: 1, enabled: true } });
    expect(followUp(source, { id: 'b', at, order: 2 })?.dueAt).toBe('2026-08-31');
  });

  it('overdue series catches up with today, keeping the rhythm', () => {
    const source = task({ dueAt: '2026-01-05', repeat: { unit: 'month', every: 1, enabled: true } });
    expect(followUp(source, { id: 'b', at, order: 2 })?.dueAt).toBe('2026-09-05');
  });

  it('month end in a series: the 31st clamps and stays clamped', () => {
    const source = task({ dueAt: '2026-01-31', repeat: { unit: 'month', every: 1, enabled: true } });
    const first = followUp(source, { id: 'b', at: Date.parse('2026-01-31T09:00:00'), order: 2 });
    expect(first?.dueAt).toBe('2026-02-28');

    const second = followUp(
      { ...source, dueAt: first?.dueAt ?? '' },
      { id: 'c', at: Date.parse('2026-02-28T09:00:00'), order: 3 },
    );
    expect(second?.dueAt).toBe('2026-03-28');
  });
});

describe('order and search', () => {
  it('in dated buckets the nearer due date is higher', () => {
    const list = [
      task({ id: 'c', dueAt: '2026-08-26' }),
      task({ id: 'a', dueAt: '2026-08-24' }),
      task({ id: 'b', dueAt: '2026-08-25' }),
    ];
    expect(sortTasks(list, 'scheduled').map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('in the inbox the order is manual, then by creation time', () => {
    const list = [
      task({ id: 'c', order: 3, createdAt: 1 }),
      task({ id: 'a', order: 1, createdAt: 9 }),
      task({ id: 'b', order: 2, createdAt: 5 }),
    ];
    expect(sortTasks(list, 'inbox').map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('in "Done" the freshest are on top', () => {
    const list = [
      task({ id: 'a', doneAt: 10 }),
      task({ id: 'c', doneAt: 30 }),
      task({ id: 'b', doneAt: 20 }),
    ];
    expect(sortTasks(list, 'done').map(item => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('in a mixed list the completed sink to the bottom', () => {
    const list = [
      task({ id: 'a', doneAt: 10 }),
      task({ id: 'b' }),
    ];
    expect(sortTasks(list, 'today').map(item => item.id)).toEqual(['b', 'a']);
  });

  it('the order is total: shuffled input yields the same result', () => {
    // Снимок коллекции приезжает в порядке ключей ленда, и на двух устройствах
    // он разный — список обязан выглядеть одинаково.
    const list = [
      task({ id: 'b', order: 1, createdAt: 1 }),
      task({ id: 'a', order: 1, createdAt: 1 }),
      task({ id: 'c', order: 1, createdAt: 1 }),
    ];
    const straight = sortTasks(list, 'inbox').map(item => item.id);
    const shuffled = sortTasks([...list].reverse(), 'inbox').map(item => item.id);
    expect(straight).toEqual(['a', 'b', 'c']);
    expect(shuffled).toEqual(straight);
  });

  it('undated tasks trail the dated ones', () => {
    const list = [task({ id: 'b' }), task({ id: 'a', dueAt: '2026-08-25' })];
    expect(sortTasks(list, 'today').map(item => item.id)).toEqual(['a', 'b']);
  });

  it('essential equality ignores the edit time', () => {
    const item = task({ dueAt: '2026-08-25', repeat: { unit: 'day', every: 2, enabled: true } });
    expect(sameTask(item, { ...item, updatedAt: item.updatedAt + 1000 })).toBeTruthy();
    expect(sameTask(item, { ...item, title: 'Другое' })).toBeFalsy();
    expect(sameTask(item, { ...item, dueAt: undefined })).toBeFalsy();
    expect(sameTask(item, { ...item, repeat: { unit: 'day', every: 3, enabled: true } })).toBeFalsy();
    expect(sameTask(item, { ...item, repeat: undefined })).toBeFalsy();
    expect(sameTask(task(), { ...task(), note: '' })).toBeFalsy();
  });

  it('search goes over title and note, ignoring case', () => {
    const item = task({ title: 'Позвонить Маше', note: 'Про Отпуск' });
    expect(matchesQuery(item, 'маш')).toBeTruthy();
    expect(matchesQuery(item, 'ОТПУСК')).toBeTruthy();
    expect(matchesQuery(item, '  позвонить ')).toBeTruthy();
    expect(matchesQuery(item, 'банк')).toBeFalsy();
    expect(matchesQuery(item, '   ')).toBeFalsy();
    expect(matchesQuery(task({ title: 'Дело' }), 'дел')).toBeTruthy();
  });

  it('search also finds by checklist items', () => {
    const item = task({
      title: 'Собраться в поход',
      steps: [{ id: 's1', title: 'Купить батарейки', order: 1 }],
    });
    expect(matchesQuery(item, 'батарей')).toBeTruthy();
    expect(matchesQuery(item, 'палатка')).toBeFalsy();
  });
});

describe('priority in a task', () => {
  it('"normal" is not written into the task: it is the absence of priority', () => {
    const created = createTask({ title: 'Дело', priority: 'normal' }, { id: 'x', at: 1, order: 1 });
    expect(Object.hasOwn(created, 'priority')).toBeFalsy();

    const high = createTask({ title: 'Дело', priority: 'high' }, { id: 'x', at: 1, order: 1 });
    expect(high.priority).toBe('high');
  });

  it('within one date urgent goes above normal', () => {
    const list = [
      task({ id: 'b', dueAt: '2026-08-24' }),
      task({ id: 'a', dueAt: '2026-08-24', priority: 'urgent' }),
      task({ id: 'c', dueAt: '2026-08-24', priority: 'low' }),
    ];
    expect(sortTasks(list, 'today').map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('DUE DATE BEATS PRIORITY: the overdue does not hide behind urgent-for-Friday', () => {
    const list = [
      task({ id: 'urgent-later', dueAt: '2026-08-28', priority: 'urgent' }),
      task({ id: 'plain-overdue', dueAt: '2026-08-20' }),
    ];
    expect(sortTasks(list, 'today').map(item => item.id)).toEqual(['plain-overdue', 'urgent-later']);
  });

  it('in dateless buckets priority decides everything: nothing else to compare there', () => {
    const list = [
      task({ id: 'b', order: 1 }),
      task({ id: 'a', order: 9, priority: 'urgent' }),
    ];
    expect(sortTasks(list, 'inbox').map(item => item.id)).toEqual(['a', 'b']);
  });

  it('in "Done" priority has no effect: there is no queue anymore, only a journal', () => {
    const list = [
      task({ id: 'a', doneAt: 10, priority: 'urgent' }),
      task({ id: 'b', doneAt: 20 }),
    ];
    expect(sortTasks(list, 'done').map(item => item.id)).toEqual(['b', 'a']);
  });

  it('essential equality sees priority but does not distinguish "normal" from empty', () => {
    const item = task();
    expect(sameTask(item, { ...item, priority: 'normal' })).toBeTruthy();
    expect(sameTask(item, { ...item, priority: 'high' })).toBeFalsy();
  });
});

describe('checklist in a task', () => {
  const STEPS = [
    { id: 's2', title: 'Второй', order: 2, doneAt: 1_700_100 },
    { id: 's1', title: 'Первый', order: 1 },
  ];

  it('arrives in the task already ordered', () => {
    const created = createTask({ title: 'Дело', steps: STEPS }, { id: 'x', at: 1, order: 1 });
    expect(created.steps?.map(item => item.id)).toEqual(['s1', 's2']);
  });

  it('empty list does not become a field', () => {
    const created = createTask({ title: 'Дело', steps: [] }, { id: 'x', at: 1, order: 1 });
    expect(Object.hasOwn(created, 'steps')).toBeFalsy();
  });

  it('essential equality sees an item edit', () => {
    const item = task({ steps: [{ id: 's1', title: 'Первый', order: 1 }] });
    expect(sameTask(item, { ...item, steps: [{ id: 's1', title: 'Другой', order: 1 }] })).toBeFalsy();
    expect(sameTask(item, { ...item, steps: [{ id: 's1', title: 'Первый', order: 1 }] })).toBeTruthy();
    expect(sameTask(item, { ...item, steps: undefined })).toBeFalsy();
  });

  it('the next repeat occurrence gets a CLEAN checklist under its own keys', () => {
    const source = task({
      dueAt: '2026-08-24',
      repeat: { unit: 'week', every: 1, enabled: true },
      steps: [
        { id: 's1', title: 'Форма', order: 1, doneAt: 1_700_100 },
        { id: 's2', title: 'Бутылка', order: 2, doneAt: 1_700_200 },
      ],
    });
    expect(followUpSteps(source)).toBe(2);

    const next = followUp(source, {
      id: 'b',
      at: Date.parse('2026-08-24T10:00:00'),
      order: 9,
      steps: ['n1', 'n2'],
    });

    expect(next?.steps).toEqual([
      { id: 'n1', title: 'Форма', order: 1 },
      { id: 'n2', title: 'Бутылка', order: 2 },
    ]);
  });

  it('task without a checklist gets no empty field on repeat', () => {
    const source = task({ dueAt: '2026-08-24', repeat: { unit: 'day', every: 1, enabled: true } });
    expect(followUpSteps(source)).toBe(0);
    const next = followUp(source, { id: 'b', at: Date.parse('2026-08-24T10:00:00'), order: 2 });
    expect(next === null || Object.hasOwn(next, 'steps')).toBeFalsy();
  });
});
