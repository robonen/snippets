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

describe('overview: counters', () => {
  it('empty list — all zeros and not a single project', () => {
    expect(overviewOf([], TODAY)).toEqual({
      open: 0,
      overdue: 0,
      today: 0,
      doneWeek: 0,
      projects: [],
    });
  });

  it('overdue and today are kept apart: the eyes add them up, not us', () => {
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

  it('completed count neither as open nor as overdue', () => {
    const list = [task({ id: '1', dueAt: '2026-08-20', doneAt: at('2026-08-22') })];
    const overview = overviewOf(list, TODAY);

    expect(overview.open).toBe(0);
    expect(overview.overdue).toBe(0);
    expect(overview.doneWeek).toBe(1);
  });

  it('"this week" — the last seven days including today', () => {
    const list = [
      task({ id: '1', doneAt: at(TODAY) }),
      task({ id: '2', doneAt: at('2026-08-18') }),
      // Восьмой день назад в неделю уже не входит.
      task({ id: '3', doneAt: at('2026-08-17') }),
    ];
    expect(overviewOf(list, TODAY).doneWeek).toBe(2);
  });

  it('future due date does not burn and does not fall into "today"', () => {
    const overview = overviewOf([task({ dueAt: '2026-09-01' })], TODAY);
    expect(overview.overdue).toBe(0);
    expect(overview.today).toBe(0);
    expect(overview.open).toBe(1);
  });

  it('deferred and untriaged are open work too', () => {
    const list = [task({ id: '1', status: 'someday' }), task({ id: '2' })];
    expect(overviewOf(list, TODAY).open).toBe(2);
  });
});

describe('day summary', () => {
  it('empty list — empty bar', () => {
    expect(dayProgress([], TODAY)).toEqual({ done: 0, total: 0 });
  });

  it('closed TODAY counts, though it already left the list', () => {
    const list = [
      task({ id: '1', doneAt: at(TODAY) }),
      task({ id: '2', dueAt: TODAY }),
    ];
    expect(dayProgress(list, TODAY)).toEqual({ done: 1, total: 2 });
  });

  it('closed yesterday does not enter the bar for today', () => {
    expect(dayProgress([task({ doneAt: at('2026-08-23') })], TODAY)).toEqual({ done: 0, total: 0 });
  });

  it('overdue is also work for today, just late', () => {
    const list = [task({ id: '1', dueAt: '2026-08-01' }), task({ id: '2', dueAt: TODAY })];
    expect(dayProgress(list, TODAY)).toEqual({ done: 0, total: 2 });
  });

  it('undated and future work does not enter the day bar', () => {
    const list = [task({ id: '1' }), task({ id: '2', dueAt: '2026-09-01' })];
    expect(dayProgress(list, TODAY)).toEqual({ done: 0, total: 0 });
  });

  it('property: done is never more than total', () => {
    const list = [
      task({ id: '1', doneAt: at(TODAY) }),
      task({ id: '2', doneAt: at(TODAY) }),
      task({ id: '3', dueAt: '2026-08-01' }),
    ];
    const progress = dayProgress(list, TODAY);
    expect(progress.done).toBeLessThanOrEqual(progress.total);
  });
});

describe('overview: per-project breakdown', () => {
  it('tasks outside projects gather into one row without an identifier', () => {
    const overview = overviewOf([task({ id: '1' })], TODAY);
    expect(overview.projects).toHaveLength(1);
    expect(Object.hasOwn(overview.projects[0] ?? {}, 'project')).toBeFalsy();
  });

  it('project counters mirror the overall ones, but only over its tasks', () => {
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

  it('order: burning first, then by amount of work', () => {
    const list = [
      task({ id: '1', project: 'тихий' }),
      task({ id: '2', project: 'тихий' }),
      task({ id: '3', project: 'горит', dueAt: '2026-08-20' }),
    ];
    expect(overviewOf(list, TODAY).projects.map(item => item.project)).toEqual(['горит', 'тихий']);
  });

  it('"outside projects" sinks on ties: it is a remainder, not a project', () => {
    const list = [task({ id: '1' }), task({ id: '2', project: 'дом' })];
    expect(overviewOf(list, TODAY).projects.map(item => item.project)).toEqual(['дом', undefined]);
  });

  it('project with only old completions stays in the overview as an empty row', () => {
    const list = [task({ id: '1', project: 'старый', doneAt: at('2026-01-01') })];
    expect(overviewOf(list, TODAY).projects).toEqual([
      { project: 'старый', open: 0, overdue: 0, done: 0 },
    ]);
  });

  it('property: per-project sums match the overall counters', () => {
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
