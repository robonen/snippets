import { describe, expect, it } from 'vitest';
import { Land, Link, createSpace, fixedClock } from '@sync/core';
import type { Space } from '@sync/core';
import { blankProject } from '../entities/project';
import type { Project } from '../entities/project';
import { ProjectsModel, readProject, writeProject } from './models';

function spaceOf(session = 0x000100): Space {
  const land = new Land(Link.peer(new Uint8Array(8).fill(0x5a)), fixedClock(1_700_000), { session });
  return createSpace({ land });
}

const PROJECT: Project = {
  ...blankProject('p1', 'Cyrille', '2023-03', 'active', 1_699_000),
  endedAt: '2024-10',
  budget: 500_000,
  summary: 'Читалка с интерактивом.',
  statusNote: '',
  stack: ['Nuxt', 'Laravel'],
  members: [
    { id: 'm1', name: 'Андрей', role: 'бэкенд', link: 'https://github.com/robonen', addedAt: 1 },
    { id: 'm2', name: 'Рома', role: 'фронтенд', addedAt: 2 },
  ],
  payments: [
    { id: 'pay1', date: '2023-04-01', amount: 50_000, share: 25_000, note: 'Первая итерация', addedAt: 1 },
    { id: 'pay2', date: '2023-08-16', amount: 3_900, note: 'Хостинг', addedAt: 2 },
  ],
  links: [{ id: 'l1', title: 'Сайт', url: 'https://cyrille.ru', addedAt: 1 }],
  journal: [{ id: 'j1', date: '2024-10-01', text: 'Завершён', addedAt: 1 }],
  updatedAt: 1_700_100,
};

describe('project models on @sync/core', () => {
  it('project survives the document → snapshot round-trip, nested rows included', () => {
    const root = spaceOf().root(ProjectsModel);
    writeProject(root.projects(PROJECT.id), PROJECT);

    expect(readProject(PROJECT.id, root.projects(PROJECT.id))).toEqual(PROJECT);
  });

  it('optional fields stay absent, not null', () => {
    const root = spaceOf().root(ProjectsModel);
    const bare = blankProject('p2', 'Пустой', '2024-01', 'active', 0);
    writeProject(root.projects('p2'), bare);

    const back = readProject('p2', root.projects('p2'));
    expect(back).toEqual(bare);
    expect(Object.hasOwn(back, 'endedAt')).toBeFalsy();
    expect(Object.hasOwn(back, 'budget')).toBeFalsy();
    expect(Object.hasOwn(back.members[0] ?? {}, 'link')).toBeFalsy();
  });

  it('rows removed from the snapshot are removed from the land', () => {
    const root = spaceOf().root(ProjectsModel);
    writeProject(root.projects(PROJECT.id), PROJECT);
    writeProject(root.projects(PROJECT.id), { ...PROJECT, payments: [PROJECT.payments[1] as Project['payments'][number]], members: [] });

    const back = readProject(PROJECT.id, root.projects(PROJECT.id));
    expect(back.payments.map(payment => payment.id)).toEqual(['pay2']);
    expect(back.members).toEqual([]);
    expect(root.projects(PROJECT.id).payments.keys()).toEqual(['pay2']);
  });

  it('payments read back in date order regardless of insertion order', () => {
    const root = spaceOf().root(ProjectsModel);
    const shuffled = { ...PROJECT, payments: [...PROJECT.payments].reverse() };
    writeProject(root.projects(PROJECT.id), shuffled);

    expect(readProject(PROJECT.id, root.projects(PROJECT.id)).payments.map(payment => payment.id)).toEqual(['pay1', 'pay2']);
  });

  it('two tabs converge: a payment added on each shows up on both', () => {
    const clock = fixedClock(1_700_000);
    const peer = Link.peer(new Uint8Array(8).fill(0x5a));
    const tabA = new Land(peer, clock, { session: 0x000100 });
    const tabB = new Land(peer, clock, { session: 0x800100 });
    const rootA = createSpace({ land: tabA }).root(ProjectsModel);
    const rootB = createSpace({ land: tabB }).root(ProjectsModel);

    writeProject(rootA.projects('x'), PROJECT);
    const partSeed = tabA.part();
    tabB.apply(partSeed.units, partSeed.balls);

    const fromA = { ...PROJECT, payments: [...PROJECT.payments, { id: 'pay3', date: '2024-01-01', amount: 1, note: 'A', addedAt: 3 }] };
    const fromB = { ...PROJECT, payments: [...PROJECT.payments, { id: 'pay4', date: '2024-02-01', amount: 2, note: 'B', addedAt: 4 }] };
    writeProject(rootA.projects('x'), fromA);
    writeProject(rootB.projects('x'), fromB);

    const partA = tabA.part();
    const partB = tabB.part();
    tabB.apply(partA.units, partA.balls);
    tabA.apply(partB.units, partB.balls);

    expect(readProject('x', rootA.projects('x')).payments.map(payment => payment.id)).toEqual(['pay1', 'pay2', 'pay3', 'pay4']);
    expect(readProject('x', rootB.projects('x')).payments.map(payment => payment.id)).toEqual(['pay1', 'pay2', 'pay3', 'pay4']);
  });
});
