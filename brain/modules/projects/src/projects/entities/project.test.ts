import { describe, expect, it } from 'vitest';
import {
  blankProject,
  countByStatus,
  groupByYear,
  knownMembers,
  lastEntry,
  matchesQuery,
  myTotal,
  paidTotal,
  receivedIn,
  remainderOf,
  sameProject,
  sortProjects,
  stackCounts,
  withStatus,
} from './project';
import type { Project } from './project';

function project(patch: Partial<Project> & { id: string }): Project {
  return { ...blankProject(patch.id, 'Проект', '2023-02', 'active', 1_000), ...patch };
}

describe('money', () => {
  const paid = project({
    id: 'p',
    budget: 100_000,
    payments: [
      { id: 'a', date: '2023-04-01', amount: 50_000, share: 25_000, note: 'Первая итерация', addedAt: 1 },
      { id: 'b', date: '2024-08-16', amount: 20_000, note: 'Android', addedAt: 2 },
    ],
  });

  it('sums payments in full and my share separately', () => {
    expect(paidTotal(paid)).toBe(70_000);
    expect(myTotal(paid)).toBe(45_000);
  });

  it('remainder needs a budget', () => {
    expect(remainderOf(paid)).toBe(30_000);
    expect(remainderOf(project({ id: 'x' }))).toBeUndefined();
  });

  it('counts my share received within a year', () => {
    expect(receivedIn([paid], 2023)).toBe(25_000);
    expect(receivedIn([paid], 2024)).toBe(20_000);
    expect(receivedIn([paid], 2022)).toBe(0);
  });
});

describe(sortProjects, () => {
  const list = [
    project({ id: 'a', title: 'Бета', startedAt: '2023-05', updatedAt: 10 }),
    project({ id: 'b', title: 'Альфа', startedAt: '2024-01', updatedAt: 30 }),
    project({ id: 'c', title: 'Гамма', startedAt: '2023-02', updatedAt: 20 }),
  ];

  it('by activity — recently touched first', () => {
    expect(sortProjects(list, 'activity').map(item => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('by start — newest start first', () => {
    expect(sortProjects(list, 'start').map(item => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('by title — Russian collation', () => {
    expect(sortProjects(list, 'title').map(item => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('groups the chronicle by start year, newest year first', () => {
    expect(groupByYear(list).map(group => [group.year, group.projects.map(item => item.id)])).toEqual([
      [2024, ['b']],
      [2023, ['a', 'c']],
    ]);
  });
});

describe(matchesQuery, () => {
  const item = project({
    id: 'p',
    title: 'Forma Media',
    summary: 'медиа-платформа для видео',
    stack: ['Nuxt', 'Laravel'],
    members: [{ id: 'm', name: 'Рома', role: 'фронтенд', addedAt: 1 }],
  });

  it('matches title, stack, people and summary regardless of case', () => {
    expect(matchesQuery(item, 'forma')).toBeTruthy();
    expect(matchesQuery(item, 'laravel')).toBeTruthy();
    expect(matchesQuery(item, 'рома')).toBeTruthy();
    expect(matchesQuery(item, 'фронт')).toBeTruthy();
    expect(matchesQuery(item, 'видео')).toBeTruthy();
    expect(matchesQuery(item, 'kotlin')).toBeFalsy();
  });

  it('empty query matches everything', () => {
    expect(matchesQuery(item, '  ')).toBeTruthy();
  });
});

describe(withStatus, () => {
  const base = project({ id: 'p' });

  it('changing the status writes the dated transition into the journal', () => {
    const paused = withStatus(base, 'paused', '2023-06-30', 5_000);
    expect(paused.status).toBe('paused');
    expect(paused.journal).toHaveLength(1);
    expect(paused.journal[0]).toMatchObject({ date: '2023-06-30', text: 'В работе → На паузе' });
    expect(paused.updatedAt).toBe(5_000);
    expect(paused.endedAt).toBeUndefined();
  });

  it('finishing proposes the current month as the end, resuming clears it', () => {
    const done = withStatus(base, 'done', '2023-06-30', 1);
    expect(done.endedAt).toBe('2023-06');
    const dropped = withStatus(base, 'dropped', '2022-01-15', 1);
    expect(dropped.endedAt).toBe('2023-02');
    const resumed = withStatus(done, 'active', '2023-07-01', 2);
    expect(resumed.endedAt).toBeUndefined();
    expect(Object.hasOwn(resumed, 'endedAt')).toBeFalsy();
  });

  it('keeps an end that was already set', () => {
    const ended = project({ id: 'e', endedAt: '2023-04' });
    expect(withStatus(ended, 'done', '2023-06-30', 1).endedAt).toBe('2023-04');
  });

  it('same status is the same object', () => {
    expect(withStatus(base, 'active', '2023-06-30', 5_000)).toBe(base);
  });

  it('lastEntry picks the latest by date', () => {
    const changed = withStatus(withStatus(base, 'paused', '2023-06-30', 1), 'done', '2024-01-10', 2);
    expect(lastEntry(changed)?.text).toBe('На паузе → Завершён');
  });
});

describe('catalog helpers', () => {
  const list = [
    project({ id: 'a', status: 'active', stack: ['Nuxt', 'Docker'], members: [{ id: '1', name: 'Рома', role: 'фронтенд', addedAt: 1 }], updatedAt: 1 }),
    project({ id: 'b', status: 'done', stack: ['Docker'], members: [{ id: '2', name: 'рома', role: 'дизайн', addedAt: 2 }], updatedAt: 2 }),
    project({ id: 'c', status: 'paused' }),
  ];

  it('counts by status with every status present', () => {
    expect(countByStatus(list)).toEqual({ active: 1, paused: 1, done: 1, dropped: 0 });
  });

  it('stack counts are sorted by frequency, then by name', () => {
    expect(stackCounts(list)).toEqual([{ name: 'Docker', count: 2 }, { name: 'Nuxt', count: 1 }]);
  });

  it('known members are unique by name, with the latest role kept', () => {
    expect(knownMembers(list).map(member => [member.name, member.role])).toEqual([['рома', 'дизайн']]);
  });

  it('sameProject ignores the edit stamp only', () => {
    const [first] = list;
    expect(sameProject(first as Project, { ...(first as Project), updatedAt: 999 })).toBeTruthy();
    expect(sameProject(first as Project, { ...(first as Project), title: 'Другой' })).toBeFalsy();
  });
});
