import { describe, expect, it } from 'vitest';
import { dayProgress, overviewOf } from './overview';
import type { Task } from './task';

const TODAY = '2026-08-24';

/** Полдень указанного дня: сравнение идёт по дню, час роли не играет. */
function at(iso: string): number {
  return new Date(`${iso}T12:00:00`).getTime();
}

function task(patch: Partial<Task> = {}): Task {
  return {
    id: 'a',
    title: 'Задача',
    status: 'active',
    createdAt: at('2026-08-01'),
    updatedAt: at('2026-08-01'),
    order: 1,
    ...patch,
  };
}

describe('сводка: счётчики', () => {
  it('пустой список — все нули и ни одного проекта', () => {
    expect(overviewOf([], TODAY)).toEqual({
      open: 0,
      overdue: 0,
      today: 0,
      doneWeek: 0,
      projects: [],
    });
  });

  it('просроченные и сегодняшние разведены: их складывают глазами, а не мы', () => {
    const list = [
      task({ id: '1', dueAt: '2026-08-20' }),
      task({ id: '2', dueAt: '2026-08-23' }),
      task({ id: '3', dueAt: TODAY }),
    ];
    const overview = overviewOf(list, TODAY);

    expect(overview.overdue).toBe(2);
    expect(overview.today).toBe(1);
    expect(overview.open).toBe(3);
  });

  it('выполненные не считаются ни открытыми, ни просроченными', () => {
    const list = [task({ id: '1', dueAt: '2026-08-20', doneAt: at('2026-08-22') })];
    const overview = overviewOf(list, TODAY);

    expect(overview.open).toBe(0);
    expect(overview.overdue).toBe(0);
    expect(overview.doneWeek).toBe(1);
  });

  it('«за неделю» — последние семь дней, включая сегодня', () => {
    const list = [
      task({ id: '1', doneAt: at(TODAY) }),
      task({ id: '2', doneAt: at('2026-08-18') }),
      // Восьмой день назад в неделю уже не входит.
      task({ id: '3', doneAt: at('2026-08-17') }),
    ];
    expect(overviewOf(list, TODAY).doneWeek).toBe(2);
  });

  it('будущий срок не горит и в «сегодня» не попадает', () => {
    const overview = overviewOf([task({ dueAt: '2026-09-01' })], TODAY);
    expect(overview.overdue).toBe(0);
    expect(overview.today).toBe(0);
    expect(overview.open).toBe(1);
  });

  it('отложенные и неразобранные — тоже открытые дела', () => {
    const list = [task({ id: '1', status: 'someday' }), task({ id: '2' })];
    expect(overviewOf(list, TODAY).open).toBe(2);
  });
});

describe('итог дня', () => {
  it('пустой список — пустая полоса', () => {
    expect(dayProgress([], TODAY)).toEqual({ done: 0, total: 0 });
  });

  it('закрытое СЕГОДНЯ считается, хотя из списка уже ушло', () => {
    const list = [
      task({ id: '1', doneAt: at(TODAY) }),
      task({ id: '2', dueAt: TODAY }),
    ];
    expect(dayProgress(list, TODAY)).toEqual({ done: 1, total: 2 });
  });

  it('закрытое вчера в сегодняшнюю полосу не входит', () => {
    expect(dayProgress([task({ doneAt: at('2026-08-23') })], TODAY)).toEqual({ done: 0, total: 0 });
  });

  it('просроченное — тоже работа на сегодня, только опоздавшая', () => {
    const list = [task({ id: '1', dueAt: '2026-08-01' }), task({ id: '2', dueAt: TODAY })];
    expect(dayProgress(list, TODAY)).toEqual({ done: 0, total: 2 });
  });

  it('дела без срока и на будущее в полосу дня не попадают', () => {
    const list = [task({ id: '1' }), task({ id: '2', dueAt: '2026-09-01' })];
    expect(dayProgress(list, TODAY)).toEqual({ done: 0, total: 0 });
  });

  it('свойство: сделанного никогда не больше, чем всего', () => {
    const list = [
      task({ id: '1', doneAt: at(TODAY) }),
      task({ id: '2', doneAt: at(TODAY) }),
      task({ id: '3', dueAt: '2026-08-01' }),
    ];
    const progress = dayProgress(list, TODAY);
    expect(progress.done).toBeLessThanOrEqual(progress.total);
  });
});

describe('сводка: разбивка по проектам', () => {
  it('задачи вне проектов собираются одной строкой без идентификатора', () => {
    const overview = overviewOf([task({ id: '1' })], TODAY);
    expect(overview.projects).toHaveLength(1);
    expect(Object.hasOwn(overview.projects[0] ?? {}, 'project')).toBeFalsy();
  });

  it('счётчики проекта повторяют общие, но только по своим задачам', () => {
    const list = [
      task({ id: '1', project: 'дом', dueAt: '2026-08-20' }),
      task({ id: '2', project: 'дом' }),
      task({ id: '3', project: 'работа', doneAt: at('2026-08-23') }),
    ];
    const overview = overviewOf(list, TODAY);

    const home = overview.projects.find(item => item.project === 'дом');
    const work = overview.projects.find(item => item.project === 'работа');

    expect(home).toEqual({ project: 'дом', open: 2, overdue: 1, done: 0 });
    expect(work).toEqual({ project: 'работа', open: 0, overdue: 0, done: 1 });
  });

  it('порядок: где горит — выше, потом по объёму работы', () => {
    const list = [
      task({ id: '1', project: 'тихий' }),
      task({ id: '2', project: 'тихий' }),
      task({ id: '3', project: 'горит', dueAt: '2026-08-20' }),
    ];
    expect(overviewOf(list, TODAY).projects.map(item => item.project)).toEqual(['горит', 'тихий']);
  });

  it('«вне проектов» при равенстве уходит вниз: это остаток, а не проект', () => {
    const list = [task({ id: '1' }), task({ id: '2', project: 'дом' })];
    expect(overviewOf(list, TODAY).projects.map(item => item.project)).toEqual(['дом', undefined]);
  });

  it('проект с одними старыми закрытиями остаётся в сводке пустой строкой', () => {
    const list = [task({ id: '1', project: 'старый', doneAt: at('2026-01-01') })];
    expect(overviewOf(list, TODAY).projects).toEqual([
      { project: 'старый', open: 0, overdue: 0, done: 0 },
    ]);
  });

  it('свойство: суммы по проектам сходятся с общими счётчиками', () => {
    const list = [
      task({ id: '1', project: 'дом', dueAt: '2026-08-20' }),
      task({ id: '2', project: 'дом', dueAt: TODAY }),
      task({ id: '3', project: 'работа' }),
      task({ id: '4' }),
      task({ id: '5', doneAt: at('2026-08-23') }),
    ];
    const overview = overviewOf(list, TODAY);
    const sum = (pick: (stat: { open: number; overdue: number; done: number }) => number): number =>
      overview.projects.reduce((total, stat) => total + pick(stat), 0);

    expect(sum(stat => stat.open)).toBe(overview.open);
    expect(sum(stat => stat.overdue)).toBe(overview.overdue);
    expect(sum(stat => stat.done)).toBe(overview.doneWeek);
  });
});
